import { NextResponse } from "next/server";
import { apiRoute, readJson } from "@/server/http/api";
import { changeOwnPassword } from "@/server/auth/login";
import { sessionCookieName, sessionCookieOptions } from "@/server/auth/session";
import { changePasswordSchema } from "@/lib/validation/schemas";

export const POST = apiRoute({ allowPendingPasswordChange: true }, async ({ req, actor }) => {
  const body = await readJson(req, changePasswordSchema);
  const session = await changeOwnPassword(actor, body.currentPassword, body.newPassword);
  // The session is rotated after a password change.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieName(), session.token, sessionCookieOptions(session.expiresAt));
  return res;
});
