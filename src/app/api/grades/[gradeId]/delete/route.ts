import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { deleteGrade } from "@/server/domain/grades";
import { deleteGradeSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

// Soft delete with mandatory reason (POST, because a body with the reason is required).
export const POST = apiRoute({ permission: "grades.create.scoped" }, async ({ req, actor, params }) => {
  const id = parseParam(uuid, params.gradeId);
  return { grade: await deleteGrade(actor, id, await readJson(req, deleteGradeSchema)) };
});
