import "server-only";
import { db } from "@/server/db/client";
import { SECURITY } from "@/server/config";
import { Errors } from "@/server/errors";
import { recordAudit, recordAuditSafe, AuditAction } from "@/server/audit/audit";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, revokeAllUserSessions, revokeSession } from "@/server/auth/session";
import { getSetting } from "@/server/domain/settings";
import type { Actor } from "@/server/authz/actor";
import type { RequestMeta } from "@/server/http/request-meta";
import { normalizeUsername } from "@/lib/validation/common";
import { passwordPolicyErrors } from "@/lib/validation/password";

/**
 * Throttling based on recorded attempts (works across app instances).
 * Counted per username – whether or not the username exists, so lockout does
 * not reveal valid accounts – and per client IP when known.
 */
async function isThrottled(username: string, ip: string | null): Promise<boolean> {
  const since = new Date(Date.now() - SECURITY.login.windowMinutes * 60_000);
  const lastSuccess = await db.loginAttempt.findFirst({
    where: { username, success: true, at: { gte: since } },
    orderBy: { at: "desc" },
    select: { at: true },
  });
  const failuresForUser = await db.loginAttempt.count({
    where: { username, success: false, at: { gt: lastSuccess?.at ?? since } },
  });
  if (failuresForUser >= SECURITY.login.maxFailuresPerUsername) return true;
  if (ip) {
    const failuresForIp = await db.loginAttempt.count({ where: { ip, success: false, at: { gte: since } } });
    if (failuresForIp >= SECURITY.login.maxFailuresPerIp) return true;
  }
  return false;
}

export type LoginResult = {
  token: string;
  expiresAt: Date;
  mustChangePassword: boolean;
};

export async function login(rawUsername: unknown, rawPassword: unknown, meta: RequestMeta): Promise<LoginResult> {
  const username = typeof rawUsername === "string" ? normalizeUsername(rawUsername) : "";
  const password = typeof rawPassword === "string" ? rawPassword : "";
  // Obviously malformed input: reject without touching the DB, same generic message.
  if (!username || username.length > 64 || !password || password.length > SECURITY.password.maxLength) {
    throw Errors.invalidCredentials();
  }

  if (await isThrottled(username, meta.ip)) {
    await recordAuditSafe(null, meta, {
      action: AuditAction.LOGIN_BLOCKED,
      outcome: "DENIED",
      metadata: { username },
    });
    throw Errors.rateLimited();
  }

  const user = await db.user.findUnique({
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
  else if (user.role === "ELEV" && !(await getSetting("features.studentAccounts"))) failure = "STUDENT_ACCOUNTS_DISABLED";

  if (failure || !user) {
    await db.loginAttempt.create({ data: { username, ip: meta.ip, success: false } });
    await recordAuditSafe(null, meta, {
      action: AuditAction.LOGIN_FAILED,
      outcome: "FAILURE",
      entityType: user ? "User" : undefined,
      entityId: user?.id,
      metadata: { username, reason: failure },
    });
    // Same message for every failure cause: no user enumeration, no status disclosure.
    throw Errors.invalidCredentials();
  }

  const actorForAudit = {
    userId: user.id,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    rankLabel: user.rank?.label ?? null,
  };
  return db.$transaction(async (tx) => {
    await tx.loginAttempt.create({ data: { username, ip: meta.ip, success: true } });
    const session = await createSession(tx, user.id, meta);
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await recordAudit(tx, { ...actorForAudit, sessionId: "" }, meta, {
      action: AuditAction.LOGIN,
      entityType: "User",
      entityId: user.id,
    });
    return { token: session.token, expiresAt: session.expiresAt, mustChangePassword: user.mustChangePassword };
  });
}

export async function logout(actor: Actor): Promise<void> {
  await db.$transaction(async (tx) => {
    await revokeSession(tx, actor.sessionId, "LOGOUT");
    await recordAudit(tx, actor, actor.meta, { action: AuditAction.LOGOUT, entityType: "User", entityId: actor.userId });
  });
}

export async function changeOwnPassword(actor: Actor, currentPassword: string, newPassword: string): Promise<void> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: actor.userId },
    select: { username: true, passwordHash: true },
  });
  if (await isThrottled(user.username, actor.meta.ip)) throw Errors.rateLimited();

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
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.userId },
      data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
    });
    // All other sessions are terminated; the current one stays valid.
    await revokeAllUserSessions(tx, actor.userId, "PASSWORD_CHANGED", actor.sessionId);
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.PASSWORD_CHANGE,
      entityType: "User",
      entityId: actor.userId,
    });
  });
}
