import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { config, SECURITY } from "@/server/config";
import { AppError, Errors } from "@/server/errors";
import { resolveSession, sessionCookieName } from "@/server/auth/session";
import { assertPermission } from "@/server/authz/policy";
import type { Actor } from "@/server/authz/actor";
import type { Permission } from "@/server/authz/permissions";
import { requestMetaFromHeaders, type RequestMeta } from "@/server/http/request-meta";
import { hitRateLimit } from "@/server/http/rate-limit";
import "@/lib/validation/zod-ro";

type RouteParams = Record<string, string>;
type RouteContext = { params: Promise<RouteParams> };

type Options = {
  /** Endpoint requires an authenticated session (default true). */
  auth?: boolean;
  /** Role-level permission checked before the handler (scope is checked inside services). */
  permission?: Permission;
  /** Allowed while the user still has to change the password (login/logout/me/change-password). */
  allowPendingPasswordChange?: boolean;
  /** Accept multipart/form-data bodies (file uploads) instead of JSON. */
  multipart?: boolean;
};

type AuthedHandler = (ctx: { req: NextRequest; actor: Actor; params: RouteParams; meta: RequestMeta }) => Promise<unknown>;
type PublicHandler = (ctx: { req: NextRequest; params: RouteParams; meta: RequestMeta }) => Promise<unknown>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MAX_JSON_BYTES = 64 * 1024;

function errorResponse(err: AppError, requestId: string) {
  return NextResponse.json(
    { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) }, requestId },
    { status: err.status, headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } },
  );
}

/** CSRF defence for state-changing requests: exact Origin match + expected content type. */
function assertSameOrigin(req: NextRequest, multipart: boolean) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== config().appOrigin) throw Errors.csrf();
  const hasBody = req.headers.get("content-length") !== "0" && req.body !== null;
  if (hasBody) {
    const ct = (req.headers.get("content-type") ?? "").toLowerCase();
    const ok = multipart ? ct.startsWith("multipart/form-data") : ct.startsWith("application/json");
    if (!ok) throw Errors.unsupportedMediaType();
  }
}

function mapError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof z.ZodError) return Errors.validation(zodDetails(err));
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return Errors.conflict("Există deja o înregistrare cu aceste date.");
    if (err.code === "P2025") return Errors.notFound();
    if (err.code === "P2003") return Errors.validation(undefined, "Referință invalidă către alte date.");
  }
  // Business-rule violations raised by DB triggers carry a Romanian message.
  const message = err instanceof Error ? err.message : "";
  const trigger = /(Poate exista un singur an școlar activ|Elevul are deja o înmatriculare activă|Clasa are deja un diriginte activ|Clasa nu aparține anului școlar)[^"]*/.exec(message);
  if (trigger) return Errors.conflict(trigger[0].replace(/\.$/, "") + ".");
  return Errors.internal();
}

export function zodDetails(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export async function readJson<T extends z.ZodType>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_JSON_BYTES) throw Errors.validation(undefined, "Cererea este prea mare.");
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_JSON_BYTES) throw new Error("too large");
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw Errors.validation(undefined, "Conținutul cererii nu este JSON valid.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw Errors.validation(zodDetails(parsed.error));
  return parsed.data;
}

export function parseParam<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  // Malformed identifiers are indistinguishable from missing resources.
  if (!parsed.success) throw Errors.notFound();
  return parsed.data;
}

export function readSessionToken(req: NextRequest): string | undefined {
  return req.cookies.get(sessionCookieName())?.value;
}

function wrap(options: Options, handler: AuthedHandler | PublicHandler) {
  return async (req: NextRequest, context?: RouteContext): Promise<Response> => {
    const meta = requestMetaFromHeaders(req.headers);
    try {
      if (meta.ip && hitRateLimit(`api:${meta.ip}`, SECURITY.api.requestsPerMinute)) throw Errors.rateLimited();
      if (!SAFE_METHODS.has(req.method)) assertSameOrigin(req, !!options.multipart);
      const params = (await context?.params) ?? {};

      let result: unknown;
      if (options.auth === false) {
        result = await (handler as PublicHandler)({ req, params, meta });
      } else {
        const actor = await resolveSession(readSessionToken(req), meta);
        if (!actor) throw Errors.unauthenticated();
        if (actor.mustChangePassword && !options.allowPendingPasswordChange) throw Errors.passwordChangeRequired();
        if (options.permission) await assertPermission(actor, options.permission);
        result = await (handler as AuthedHandler)({ req, actor, params, meta });
      }

      const res = result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
      res.headers.set("Cache-Control", "no-store");
      res.headers.set("X-Request-Id", meta.requestId);
      return res;
    } catch (err) {
      const appErr = mapError(err);
      if (appErr.status >= 500) console.error(`[api] ${req.method} ${req.nextUrl.pathname} ${meta.requestId}`, err);
      return errorResponse(appErr, meta.requestId);
    }
  };
}

export function apiRoute(options: Options & { auth?: true }, handler: AuthedHandler) {
  return wrap(options, handler);
}

export function publicApiRoute(handler: PublicHandler) {
  return wrap({ auth: false }, handler);
}
