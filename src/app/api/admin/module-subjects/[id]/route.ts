import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { removeModuleSubject, updateModuleSubject } from "@/server/domain/curriculum";
import { updateModuleSubjectSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const PATCH = apiRoute({ permission: "structure.manage" }, async ({ req, actor, params }) => ({
  moduleSubject: await updateModuleSubject(actor, parseParam(uuid, params.id), await readJson(req, updateModuleSubjectSchema)),
}));

export const DELETE = apiRoute({ permission: "structure.manage" }, async ({ actor, params }) =>
  removeModuleSubject(actor, parseParam(uuid, params.id)),
);
