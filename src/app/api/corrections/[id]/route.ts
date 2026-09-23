import { apiRoute, parseParam } from "@/server/http/api";
import { getCorrectionRequest } from "@/server/domain/corrections";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({}, async ({ actor, params }) => ({ request: await getCorrectionRequest(actor, parseParam(uuid, params.id)) }));
