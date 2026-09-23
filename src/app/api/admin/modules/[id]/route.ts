import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { updateModule } from "@/server/domain/curriculum";
import { updateModuleSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const PATCH = apiRoute({ permission: "structure.manage" }, async ({ req, actor, params }) => {
  const id = parseParam(uuid, params.id);
  return { module: await updateModule(actor, id, await readJson(req, updateModuleSchema)) };
});
