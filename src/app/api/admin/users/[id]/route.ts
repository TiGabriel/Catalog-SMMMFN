import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { getUser, updateUser } from "@/server/domain/users";
import { updateUserSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({ permission: "users.manage" }, async ({ actor, params }) => ({
  user: await getUser(actor, parseParam(uuid, params.id)),
}));

export const PATCH = apiRoute({ permission: "users.manage" }, async ({ req, actor, params }) => {
  const id = parseParam(uuid, params.id);
  const body = await readJson(req, updateUserSchema);
  return { user: await updateUser(actor, id, body) };
});
