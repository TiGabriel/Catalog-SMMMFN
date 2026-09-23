import "server-only";
import { createHash } from "node:crypto";
import { db, type DbOrTx } from "@/server/db/client";
import { SECURITY } from "@/server/config";
import { Errors } from "@/server/errors";
import { recordAudit, recordAuditSafe, AuditAction } from "@/server/audit/audit";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, hashToken, revokeAllUserSessions, revokeSession } from "@/server/auth/session";
import { getSetting } from "@/server/domain/settings";
import type { Actor } from "@/server/authz/actor";
import type { RequestMeta } from "@/server/http/request-meta";
import { normalizeUsername, USERNAME_REGEX } from "@/lib/validation/common";
import { passwordPolicyErrors } from "@/lib/validation/password";

/**
 * Throttling based on recorded attempts (works across app instances).
 * Counted per username – whether or not the username exists, so lockout does
 * not reveal valid accounts – and per client IP when known.
 */
async function isThrottled(client: DbOrTx, usernameKey: string, ip: string | null): Promise<boolean> {
  const since = new Date(Date.now() - SECURITY.login.windowMinutes * 60_000);
  const lastSuccess = await client.loginAttempt.findFirst({
    where: { username: usernameKey, success: true, at: { gte: since } },
    orderBy: { at: "desc" },
    select: { at: true },
  });
  const failuresForUser = await client.loginAttempt.count({
    where: { username: usernameKey, success: false, at: { gt: lastSuccess?.at ?? since } },
  });
  if (failuresForUser >= SECURITY.login.maxFailuresPerUsername) return true;
  if (ip) {
    const failuresForIp = await client.loginAttempt.count({ where: { ip, success: false, at: { gte: since } } });
    if (failuresForIp >= SECURITY.login.maxFailuresPerIp) return true;
  }
  return false;
}

/**
 * Key under which attempts are counted and audited. A value that is not a valid
 * username (e.g. a password typed into the username field) is never stored in
 * clear – only as a hash, still usable for throttling.
 */
function attemptKey(username: string): { key: string; display: string } {
  if (USERNAME_REGEX.test(username)) return { key: username, display: username };
  return { key: `h:${createHash("sha256").update(username).digest("hex").slice(0, 32)}`, display: "[format invalid]" };
}

export type LoginResult = {
  token: string;
  expiresAt: Date;
  mustChangePassword: boolean;
};

type Outcome =
  | { kind: "blocked" }
  | { kind: "failed"; reason: string; userId: string | null }
  | { kind: "ok"; result: LoginResult };

export async function login(rawUsername: unknown, rawPassword: unknown, meta: RequestMeta, previousToken?: string): Promise<LoginResult> {
  const username = typeof rawUsername === "string" ? normalizeUsername(rawUsername) : "";
  const password = typeof rawPassword === "string" ? rawPassword : "";
  // Obviously malformed input: reject without touching the DB, same generic message.
  if (!username || username.length > 64 || !password || password.length > SECURITY.password.maxLength) {
    throw Errors.invalidCredentials();
  }
  const { key, display } = attemptKey(username);
  const studentAccounts = await getSetting("features.studentAccounts");

  // Check → verify → record is serialized per username, so parallel requests
  // cannot slip past the failure limit (brute-force race).
  const outcome: Outcome = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"login:" + key}))`;
      if (await isThrottled(tx, key, meta.ip)) return { kind: "blocked" };

      const user = await tx.user.findUnique({
        where: { username },
        select: {
          id: true,
          role: true,
          status: true,
          passwordHash: true,
          firstName: true,
          lastName: true,
          mustChangePassword: true,
          rank: { select: { label: true } },
        },
      });
      // Always verify (dummy hash for unknown users) to keep timing uniform.
      const passwordOk = await verifyPassword(user?.passwordHash, password);
      let failure: string | null = null;
      if (!user) failure = "UNKNOWN_USER";
      else if (!passwordOk) failure = "BAD_PASSWORD";
      else if (user.status !== "ACTIVE") failure = "USER_NOT_ACTIVE";
      else if (user.role === "ELEV" && !studentAccounts) failure = "STUDENT_ACCOUNTS_DISABLED";

      if (failure || !user) {
        await tx.loginAttempt.create({ data: { username: key, ip: meta.ip, success: false } });
        return { kind: "failed", reason: failure ?? "UNKNOWN_USER", userId: user?.id ?? null };
      }

      await tx.loginAttempt.create({ data: { username: key, ip: meta.ip, success: true } });
      // Session fixation defence: a session presented by the browser is never reused.
      if (previousToken) await revokeSession(tx, hashToken(previousToken), "REPLACED_BY_LOGIN");
      const session = await createSession(tx, user.id, meta);
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await recordAudit(
        tx,
        { userId: user.id, role: user.role, firstName: user.firstName, lastName: user.lastName, rankLabel: user.rank?.label ?? null, sessionId: "" },
        meta,
        { action: AuditAction.LOGIN, entityType: "User", entityId: user.id },
      );
      return { kind: "ok", result: { token: session.token, expiresAt: session.expiresAt, mustChangePassword: user.mustChangePassword } };
    },
    { timeout: 20_000, maxWait: 10_000 },
  );

  if (outcome.kind === "ok") return outcome.result;
  if (outcome.kind === "blocked") {
    await recordAuditSafe(null, meta, { action: AuditAction.LOGIN_BLOCKED, outcome: "DENIED", metadata: { username: display } });
    throw Errors.rateLimited();
  }
  await recordAuditSafe(null, meta, {
    action: AuditAction.LOGIN_FAILED,
    outcome: "FAILURE",
    entityType: outcome.userId ? "User" : undefined,
    entityId: outcome.userId ?? undefined,
    metadata: { username: display, reason: outcome.reason },
  });
  // Same message for every failure cause: no user enumeration, no status disclosure.
  throw Errors.invalidCredentials();
}

export async function logout(actor: Actor): Promise<void> {
  await db.$transaction(async (tx) => {
    await revokeSession(tx, actor.sessionId, "LOGOUT");
    await recordAudit(tx, actor, actor.meta, { action: AuditAction.LOGOUT, entityType: "User", entityId: actor.userId });
  });
}

/** Changes the password and rotates the session: every session (including the current one) is replaced. */
export async function changeOwnPassword(actor: Actor, currentPassword: string, newPassword: string): Promise<{ token: string; expiresAt: Date }> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { username: true, passwordHash: true },
  });
  if (await isThrottled(db, user.username, actor.meta.ip)) throw Errors.rateLimited();

  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    await db.loginAttempt.create({ data: { username: user.username, ip: actor.meta.ip, success: false } });
    await recordAuditSafe(actor, actor.meta, {
      action: AuditAction.PASSWORD_CHANGE_FAILED,
      outcome: "FAILURE",
      entityType: "User",
      entityId: actor.userId,
    });
    throw Errors.validation({ currentPassword: ["Parola actuală este incorectă."] });
  }
  const policy = passwordPolicyErrors(newPassword, user.username);
  if (policy.length) throw Errors.validation({ newPassword: policy });
  if (await verifyPassword(user.passwordHash, newPassword)) {
    throw Errors.validation({ newPassword: ["Parola nouă trebuie să fie diferită de cea actuală."] });
  }

  const passwordHash = await hashPassword(newPassword);
  return db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.userId },
      data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
    });
    await revokeAllUserSessions(tx, actor.userId, "PASSWORD_CHANGED");
    const session = await createSession(tx, actor.userId, actor.meta);
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.PASSWORD_CHANGE,
      entityType: "User",
      entityId: actor.userId,
    });
    return session;
  });
}
