import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { getGradeWithHistory, updateGrade } from "@/server/domain/grades";
import { updateGradeSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({}, async ({ actor, params }) => getGradeWithHistory(actor, parseParam(uuid, params.gradeId)));

export const PATCH = apiRoute({ permission: "grades.create.scoped" }, async ({ req, actor, params }) => {
  const id = parseParam(uuid, params.gradeId);
  return { grade: await updateGrade(actor, id, await readJson(req, updateGradeSchema)) };
});
