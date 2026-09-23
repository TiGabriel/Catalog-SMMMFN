import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { setUserStatus } from "@/server/domain/users";
import { setUserStatusSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const POST = apiRoute({ permission: "users.manage" }, async ({ req, actor, params }) => {
  const id = parseParam(uuid, params.id);
  const body = await readJson(req, setUserStatusSchema);
  return { user: await setUserStatus(actor, id, body.status, body.reason) };
});
