import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db, type DbOrTx } from "@/server/db/client";
import { config, SECURITY } from "@/server/config";
import type { Actor } from "@/server/authz/actor";
import { getSetting } from "@/server/domain/settings";
import type { RequestMeta } from "@/server/http/request-meta";

export function sessionCookieName(): string {
  // The __Host- prefix forces Secure, Path=/ and no Domain attribute in the browser.
  return config().cookieSecure ? "__Host-sesiune" : "sesiune";
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: config().cookieSecure,
    sameSite: "strict" as const,
    path: "/",
    expires: expiresAt,
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createSession(client: DbOrTx, userId: string, meta: RequestMeta) {
  const token = randomBytes(32).toString("base64url"); // 256 bits
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SECURITY.session.absoluteTimeoutHours * 3600_000);
  await client.session.create({
    data: { id: hashToken(token), userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent },
  });
  return { token, expiresAt };
}

/**
 * Resolves the actor for a raw session token. Returns null if the session is
 * unknown, revoked, expired (absolute or idle) or the user is no longer ACTIVE.
 */
export async function resolveSession(token: string | undefined | null, meta: RequestMeta): Promise<Actor | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const id = hashToken(token);
  const session = await db.session.findUnique({
    where: { id },
    select: {
      id: true,
      expiresAt: true,
      lastSeenAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          role: true,
          status: true,
          firstName: true,
          lastName: true,
          mustChangePassword: true,
          rank: { select: { label: true } },
        },
      },
    },
  });
  if (!session || session.revokedAt) return null;

  const now = Date.now();
  const idleLimit = SECURITY.session.idleTimeoutMinutes * 60_000;
  if (session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > idleLimit) {
    await db.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "EXPIRED" },
    });
    return null;
  }
  // Student sessions end as soon as student accounts are disabled.
  const inactiveStudent = session.user.role === "ELEV" && !(await getSetting("features.studentAccounts"));
  if (session.user.status !== "ACTIVE" || inactiveStudent) {
    await db.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "USER_NOT_ACTIVE" },
    });
    return null;
  }
  if (now - session.lastSeenAt.getTime() > SECURITY.session.touchIntervalSeconds * 1000) {
    await db.session.update({ where: { id }, data: { lastSeenAt: new Date() } });
  }
  return {
    userId: session.user.id,
    role: session.user.role,
    firstName: session.user.firstName,
    lastName: session.user.lastName,
    rankLabel: session.user.rank?.label ?? null,
    mustChangePassword: session.user.mustChangePassword,
    sessionId: session.id,
    meta,
  };
}

export async function revokeSession(client: DbOrTx, sessionId: string, reason: string) {
  await client.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
}

export async function revokeAllUserSessions(client: DbOrTx, userId: string, reason: string, exceptSessionId?: string) {
  await client.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
}
