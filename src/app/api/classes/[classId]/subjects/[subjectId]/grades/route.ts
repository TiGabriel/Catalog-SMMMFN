import { apiRoute, parseParam } from "@/server/http/api";
import { getClassSubjectGrades } from "@/server/domain/catalog";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({}, async ({ actor, params }) =>
  getClassSubjectGrades(actor, parseParam(uuid, params.classId), parseParam(uuid, params.subjectId)),
);
