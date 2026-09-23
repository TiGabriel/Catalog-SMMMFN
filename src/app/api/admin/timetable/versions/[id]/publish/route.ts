import { apiRoute, parseParam } from "@/server/http/api";
import { publishTimetableVersion } from "@/server/domain/timetable-admin";
import { uuid } from "@/lib/validation/common";

export const POST = apiRoute({ permission: "timetable.manage" }, async ({ actor, params }) => ({
  version: await publishTimetableVersion(actor, parseParam(uuid, params.id)),
}));
