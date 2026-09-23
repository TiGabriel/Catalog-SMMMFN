import { apiRoute, readJson } from "@/server/http/api";
import { changeOwnPassword } from "@/server/auth/login";
import { changePasswordSchema } from "@/lib/validation/schemas";

export const POST = apiRoute({ allowPendingPasswordChange: true }, async ({ req, actor }) => {
  const body = await readJson(req, changePasswordSchema);
  await changeOwnPassword(actor, body.currentPassword, body.newPassword);
  return { ok: true };
});
