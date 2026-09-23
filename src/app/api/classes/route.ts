import { apiRoute } from "@/server/http/api";
import { listMyClasses } from "@/server/domain/catalog";

export const GET = apiRoute({}, async ({ actor }) => ({ classes: await listMyClasses(actor) }));
