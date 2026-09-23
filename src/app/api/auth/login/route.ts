import { NextResponse } from "next/server";
import { publicApiRoute, readJson, readSessionToken } from "@/server/http/api";
import { login } from "@/server/auth/login";
import { sessionCookieName, sessionCookieOptions } from "@/server/auth/session";
import { loginSchema } from "@/lib/validation/schemas";

export const POST = publicApiRoute(async ({ req, meta }) => {
  const body = await readJson(req, loginSchema);
  const result = await login(body.username, body.password, meta, readSessionToken(req));
  const res = NextResponse.json({ ok: true, mustChangePassword: result.mustChangePassword });
  res.cookies.set(sessionCookieName(), result.token, sessionCookieOptions(result.expiresAt));
  return res;
});
