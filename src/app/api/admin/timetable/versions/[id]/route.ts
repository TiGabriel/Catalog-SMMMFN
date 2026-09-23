import { apiRoute, parseParam } from "@/server/http/api";
import { getTimetableVersion } from "@/server/domain/timetable-admin";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({ permission: "timetable.manage" }, async ({ actor, params }) => getTimetableVersion(actor, parseParam(uuid, params.id)));
