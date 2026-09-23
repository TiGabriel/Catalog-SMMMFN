import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { updateGradeReason } from "@/server/domain/curriculum";
import { updateGradeReasonSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const PATCH = apiRoute({ permission: "config.manage" }, async ({ req, actor, params }) => {
  const id = parseParam(uuid, params.id);
  return { gradeReason: await updateGradeReason(actor, id, await readJson(req, updateGradeReasonSchema)) };
});
