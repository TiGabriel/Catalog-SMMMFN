import { apiRoute } from "@/server/http/api";
import { previewRollover } from "@/server/domain/rollover";

export const GET = apiRoute({ permission: "structure.manage" }, async ({ actor }) => ({ plan: await previewRollover(actor) }));
