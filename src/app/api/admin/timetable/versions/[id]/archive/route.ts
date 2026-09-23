import { apiRoute, parseParam } from "@/server/http/api";
import { archiveTimetableVersion } from "@/server/domain/timetable-admin";
import { uuid } from "@/lib/validation/common";

export const POST = apiRoute({ permission: "timetable.manage" }, async ({ actor, params }) => ({
  version: await archiveTimetableVersion(actor, parseParam(uuid, params.id)),
}));
