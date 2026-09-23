import { apiRoute, parseParam } from "@/server/http/api";
import { getStudentOverview } from "@/server/domain/catalog";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({}, async ({ actor, params }) => getStudentOverview(actor, parseParam(uuid, params.studentId)));
