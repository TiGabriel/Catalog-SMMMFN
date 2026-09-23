import { apiRoute } from "@/server/http/api";
import { listAuditEntries } from "@/server/domain/audit-read";
import { auditQuerySchema } from "@/lib/validation/schemas";
import { Errors } from "@/server/errors";

export const GET = apiRoute({ permission: "audit.read" }, async ({ req, actor }) => {
  const parsed = auditQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw Errors.validation();
  return listAuditEntries(actor, parsed.data);
});
