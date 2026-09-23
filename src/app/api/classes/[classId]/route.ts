import { apiRoute, parseParam } from "@/server/http/api";
import { getClassOverview } from "@/server/domain/catalog";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({}, async ({ actor, params }) => getClassOverview(actor, parseParam(uuid, params.classId)));
