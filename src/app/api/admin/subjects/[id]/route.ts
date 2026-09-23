import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { updateSubject } from "@/server/domain/curriculum";
import { updateSubjectSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const PATCH = apiRoute({ permission: "structure.manage" }, async ({ req, actor, params }) => {
  const id = parseParam(uuid, params.id);
  return { subject: await updateSubject(actor, id, await readJson(req, updateSubjectSchema)) };
});
