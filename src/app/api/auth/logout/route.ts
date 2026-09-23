import { NextResponse } from "next/server";
import { apiRoute } from "@/server/http/api";
import { logout } from "@/server/auth/login";
import { sessionCookieName, sessionCookieOptions } from "@/server/auth/session";

export const POST = apiRoute({ allowPendingPasswordChange: true }, async ({ actor }) => {
  await logout(actor);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookieName(), "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
  return res;
});
