import { apiRoute } from "@/server/http/api";
import { verifyAuditChain } from "@/server/domain/audit-read";

export const GET = apiRoute({ permission: "audit.read" }, async ({ actor }) => verifyAuditChain(actor));
