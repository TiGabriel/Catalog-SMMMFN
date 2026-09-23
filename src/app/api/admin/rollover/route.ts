import { apiRoute } from "@/server/http/api";
import { listRollovers } from "@/server/domain/rollover";

export const GET = apiRoute({ permission: "structure.read" }, async ({ actor }) => ({ rollovers: await listRollovers(actor) }));
