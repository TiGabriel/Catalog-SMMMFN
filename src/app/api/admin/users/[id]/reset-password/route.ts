import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { resetPassword } from "@/server/domain/users";
import { resetPasswordSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const POST = apiRoute({ permission: "users.manage" }, async ({ req, actor, params }) => {
  const id = parseParam(uuid, params.id);
  const body = await readJson(req, resetPasswordSchema);
  return resetPassword(actor, id, body.temporaryPassword);
});
