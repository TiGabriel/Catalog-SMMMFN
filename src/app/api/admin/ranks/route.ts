import { apiRoute } from "@/server/http/api";
import { listRanks } from "@/server/domain/users";

export const GET = apiRoute({ permission: "structure.read" }, async () => ({ ranks: await listRanks() }));
