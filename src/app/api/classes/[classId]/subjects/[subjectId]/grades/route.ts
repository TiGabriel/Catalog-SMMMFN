import { apiRoute, parseParam } from "@/server/http/api";
import { getClassSubjectGrades } from "@/server/domain/catalog";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({}, async ({ req, actor, params }) => {
  const moduleId = req.nextUrl.searchParams.get("moduleId");
  return getClassSubjectGrades(
    actor,
    parseParam(uuid, params.classId),
    parseParam(uuid, params.subjectId),
    moduleId ? parseParam(uuid, moduleId) : undefined,
  );
});
