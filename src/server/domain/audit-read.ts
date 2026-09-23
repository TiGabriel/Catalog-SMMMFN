import "server-only";
import type { z } from "zod";
import { db } from "@/server/db/client";
import { assertPermission } from "@/server/authz/policy";
import { recordAudit, AuditAction } from "@/server/audit/audit";
import type { Actor } from "@/server/authz/actor";
import type { auditQuerySchema } from "@/lib/validation/schemas";

/** Audit trail – ADMINISTRATOR and COMANDANT UNITATE only. Every read is itself audited. */
export async function listAuditEntries(actor: Actor, query: z.infer<typeof auditQuerySchema>) {
  await assertPermission(actor, "audit.read");
  const where = {
    action: query.action,
    actorId: query.actorId,
    occurredAt: {
      gte: query.from,
      lt: query.to ? new Date(query.to.getTime() + 86_400_000) : undefined,
    },
  };
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  await recordAudit(db, actor, actor.meta, {
    action: AuditAction.AUDIT_VIEW,
    metadata: { filter: { ...query, from: query.from?.toISOString(), to: query.to?.toISOString() } },
  });
  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    entries: rows.map((r) => ({ ...r, id: r.id.toString() })),
  };
}

export async function verifyAuditChain(actor: Actor) {
  await assertPermission(actor, "audit.read");
  const [row] = await db.$queryRaw<{ checked: bigint; first_invalid_id: bigint | null }[]>`
    SELECT checked, first_invalid_id FROM audit_log_verify_chain()`;
  await recordAudit(db, actor, actor.meta, { action: AuditAction.AUDIT_VERIFY });
  return {
    checked: Number(row?.checked ?? 0),
    intact: row?.first_invalid_id == null,
    firstInvalidId: row?.first_invalid_id?.toString() ?? null,
  };
}
