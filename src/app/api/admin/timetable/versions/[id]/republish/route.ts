import { apiRoute, parseParam } from "@/server/http/api";
import { republishTimetableVersion } from "@/server/domain/timetable-admin";
import { uuid } from "@/lib/validation/common";

export const POST = apiRoute({ permission: "timetable.manage" }, async ({ actor, params }) => ({
  version: await republishTimetableVersion(actor, parseParam(uuid, params.id)),
}));
