import { apiRoute, parseParam } from "@/server/http/api";
import { listTimetableVersions } from "@/server/domain/timetable-admin";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({ permission: "timetable.manage" }, async ({ req, actor }) => {
  const y = req.nextUrl.searchParams.get("academicYearId");
  return { versions: await listTimetableVersions(actor, y ? parseParam(uuid, y) : undefined) };
});
