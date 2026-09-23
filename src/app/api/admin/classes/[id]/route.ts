import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { updateClass } from "@/server/domain/academic";
import { updateClassSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const PATCH = apiRoute({ permission: "structure.manage" }, async ({ req, actor, params }) => {
  const id = parseParam(uuid, params.id);
  return { class: await updateClass(actor, id, await readJson(req, updateClassSchema)) };
});
