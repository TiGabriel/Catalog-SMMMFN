import { apiRoute } from "@/server/http/api";
import { listSettings } from "@/server/domain/settings";

export const GET = apiRoute({ permission: "config.read" }, async ({ actor }) => ({ settings: await listSettings(actor) }));
