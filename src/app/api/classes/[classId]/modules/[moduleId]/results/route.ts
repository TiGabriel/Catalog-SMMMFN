import { apiRoute, parseParam } from "@/server/http/api";
import { getModuleResults } from "@/server/domain/results";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({}, async ({ actor, params }) =>
  getModuleResults(actor, parseParam(uuid, params.classId), parseParam(uuid, params.moduleId)),
);
