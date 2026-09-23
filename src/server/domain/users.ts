import "server-only";
import type { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Role, UserStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db/client";
import { Errors } from "@/server/errors";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import { assertPermission, hasPermission } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import { hashPassword } from "@/server/auth/password";
import { revokeAllUserSessions } from "@/server/auth/session";
import { getSetting } from "@/server/domain/settings";
import { passwordPolicyErrors } from "@/lib/validation/password";
import type { createUserSchema, updateUserSchema } from "@/lib/validation/schemas";

/** Explicit projection: password hashes and security counters never leave the server. */
export const userPublicSelect = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  role: true,
  status: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  deactivatedAt: true,
  rank: { select: { id: true, label: true } },
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof userPublicSelect }>;

export async function listUsers(actor: Actor, filter: { role?: Role; status?: UserStatus } = {}) {
  await assertPermission(actor, "users.manage");
  return db.user.findMany({
    where: { role: filter.role, status: filter.status },
    select: userPublicSelect,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

async function findUserOr404(id: string) {
  const user = await db.user.findUnique({ where: { id }, select: userPublicSelect });
  if (!user) throw Errors.notFound();
  return user;
}

export async function getUser(actor: Actor, id: string) {
  await assertPermission(actor, "users.manage");
  return findUserOr404(id);
}

async function assertRankExists(rankId: string | null | undefined) {
  if (!rankId) return;
  const rank = await db.rank.findUnique({ where: { id: rankId }, select: { active: true } });
  if (!rank || !rank.active) throw Errors.validation({ rankId: ["Grad militar invalid."] });
}

async function countOtherActiveAdmins(excludeId: string) {
  return db.user.count({ where: { role: "ADMINISTRATOR", status: "ACTIVE", id: { not: excludeId } } });
}

export async function createUser(actor: Actor, input: z.infer<typeof createUserSchema>) {
  await assertPermission(actor, "users.manage");
  const policy = passwordPolicyErrors(input.temporaryPassword, input.username);
  if (policy.length) throw Errors.validation({ temporaryPassword: policy });
  await assertRankExists(input.rankId);

  if (input.role === "ELEV") {
    if (!(await getSetting("features.studentAccounts"))) {
      throw Errors.validation(undefined, "Conturile de elev nu sunt activate.");
    }
    if (!input.studentId) throw Errors.validation({ studentId: ["Selectați elevul."] });
    const student = await db.student.findUnique({ where: { id: input.studentId }, select: { userId: true, status: true } });
    if (!student || student.status !== "ACTIVE") throw Errors.validation({ studentId: ["Elev invalid."] });
    if (student.userId) throw Errors.conflict("Elevul are deja un cont.");
  } else if (input.studentId) {
    throw Errors.validation({ studentId: ["Doar conturile de elev se asociază unui elev."] });
  }

  const passwordHash = await hashPassword(input.temporaryPassword);
  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        rankId: input.rankId ?? null,
        username: input.username,
        role: input.role,
        passwordHash,
        mustChangePassword: true,
      },
      select: userPublicSelect,
    });
    if (input.role === "ELEV" && input.studentId) {
      await tx.student.update({ where: { id: input.studentId }, data: { userId: user.id } });
    }
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.USER_CREATE,
      entityType: "User",
      entityId: user.id,
      studentId: input.studentId,
      after: { username: user.username, role: user.role, firstName: user.firstName, lastName: user.lastName, rank: user.rank?.label ?? null },
    });
    return user;
  });
}

export async function updateUser(actor: Actor, id: string, input: z.infer<typeof updateUserSchema>) {
  await assertPermission(actor, "users.manage");
  const before = await findUserOr404(id);
  if (before.status === "DELETED") throw Errors.conflict("Contul a fost șters și nu mai poate fi modificat.");
  await assertRankExists(input.rankId);

  const roleChanges = input.role !== undefined && input.role !== before.role;
  if (roleChanges) {
    if (id === actor.userId) throw Errors.conflict("Nu vă puteți modifica propriul rol.");
    if (before.role === "ELEV") throw Errors.conflict("Rolul unui cont de elev nu poate fi schimbat.");
    if (before.role === "PROFESOR") {
      const active = await db.teachingAssignment.count({ where: { teacherId: id, endedAt: null } });
      const homeroom = await db.homeroomAssignment.count({ where: { teacherId: id, endedAt: null } });
      if (active + homeroom > 0) {
        throw Errors.conflict("Încheiați mai întâi repartizările active ale profesorului.");
      }
    }
    if (before.role === "ADMINISTRATOR" && (await countOtherActiveAdmins(id)) === 0) {
      throw Errors.conflict("Trebuie să existe cel puțin un administrator activ.");
    }
  }

  return db.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        rankId: input.rankId === undefined ? undefined : input.rankId,
        role: input.role,
      },
      select: userPublicSelect,
    });
    // A privilege change invalidates every existing session of that user.
    if (roleChanges) await revokeAllUserSessions(tx, id, "ROLE_CHANGED");
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.USER_UPDATE,
      entityType: "User",
      entityId: id,
      before: { firstName: before.firstName, lastName: before.lastName, rank: before.rank?.label ?? null, role: before.role },
      after: { firstName: user.firstName, lastName: user.lastName, rank: user.rank?.label ?? null, role: user.role },
    });
    return user;
  });
}

/**
 * ACTIVE ↔ INACTIVE, or → DELETED (irreversible: login removed, the row and
 * the name stay so historical grades/audit keep their author).
 */
export async function setUserStatus(actor: Actor, id: string, status: UserStatus, reason: string) {
  await assertPermission(actor, "users.manage");
  if (id === actor.userId) throw Errors.conflict("Nu vă puteți modifica propria stare a contului.");
  const before = await findUserOr404(id);
  if (before.status === "DELETED") throw Errors.conflict("Contul a fost deja șters.");
  if (before.status === status) return before;
  if (before.role === "ADMINISTRATOR" && status !== "ACTIVE" && (await countOtherActiveAdmins(id)) === 0) {
    throw Errors.conflict("Trebuie să existe cel puțin un administrator activ.");
  }

  return db.$transaction(async (tx) => {
    const data: Prisma.UserUpdateInput =
      status === "ACTIVE"
        ? { status, deactivatedAt: null }
        : status === "INACTIVE"
          ? { status, deactivatedAt: new Date() }
          : {
              status,
              deactivatedAt: new Date(),
              passwordHash: null,
              // Free the username; the original stays in the audit record below.
              username: `sters.${id.slice(0, 8)}.${Date.now().toString(36)}`,
            };
    const user = await tx.user.update({ where: { id }, data, select: userPublicSelect });
    if (status !== "ACTIVE") await revokeAllUserSessions(tx, id, `USER_${status}`);
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.USER_STATUS_CHANGE,
      entityType: "User",
      entityId: id,
      before: { status: before.status, username: before.username },
      after: { status: user.status, username: user.username },
      reason,
    });
    return user;
  });
}

export async function resetPassword(actor: Actor, id: string, temporaryPassword: string) {
  await assertPermission(actor, "users.manage");
  if (id === actor.userId) throw Errors.conflict("Pentru propriul cont folosiți „Schimbare parolă”.");
  const target = await findUserOr404(id);
  if (target.status === "DELETED") throw Errors.conflict("Contul a fost șters.");
  const policy = passwordPolicyErrors(temporaryPassword, target.username);
  if (policy.length) throw Errors.validation({ temporaryPassword: policy });
  const passwordHash = await hashPassword(temporaryPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() },
    });
    await revokeAllUserSessions(tx, id, "PASSWORD_RESET");
    await recordAudit(tx, actor, actor.meta, {
      action: AuditAction.PASSWORD_RESET,
      entityType: "User",
      entityId: id,
      metadata: { username: target.username },
    });
  });
  return { ok: true };
}

export async function listRanks() {
  return db.rank.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true, category: true } });
}

/** Teachers for filters of global views (administrator, commander). Names only. */
export async function listTeachersForFilter(actor: Actor) {
  if (!hasPermission(actor, "timetable.read.all")) await assertPermission(actor, "timetable.read.all");
  return db.user.findMany({
    where: { role: "PROFESOR", status: { not: "DELETED" } },
    select: { id: true, firstName: true, lastName: true, rank: { select: { label: true } } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}
