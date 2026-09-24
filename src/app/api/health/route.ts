import { publicApiRoute } from "@/server/http/api";
import { checkDatabase } from "@/server/domain/health";

/**
 * Liveness/readiness probe for monitoring (uptime checks, load balancer).
 * Public by design: it reveals only whether the service and its database respond.
 */
export const GET = publicApiRoute(async () => {
  const ok = await checkDatabase();
  return Response.json({ status: ok ? "ok" : "indisponibil" }, { status: ok ? 200 : 503 });
});
