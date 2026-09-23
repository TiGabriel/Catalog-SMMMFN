import "server-only";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppError } from "@/server/errors";
import { resolveSession, sessionCookieName } from "@/server/auth/session";
import { requestMetaFromHeaders } from "@/server/http/request-meta";
import { getCapabilities, type Capabilities } from "@/server/domain/profile";
import type { Actor } from "@/server/authz/actor";

/**
 * Resolves the actor for a server-rendered page. Pages never trust client
 * state: the session cookie is validated against the DB on every render.
 */
export async function getPageActor(opts: { allowPendingPasswordChange?: boolean } = {}): Promise<Actor> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const actor = await resolveSession(cookieStore.get(sessionCookieName())?.value, requestMetaFromHeaders(headerStore));
  if (!actor) redirect("/autentificare");
  if (actor.mustChangePassword && !opts.allowPendingPasswordChange) redirect("/schimbare-parola");
  return actor;
}

export async function getPageContext(): Promise<{ actor: Actor; caps: Capabilities }> {
  const actor = await getPageActor();
  return { actor, caps: await getCapabilities(actor) };
}

/** Runs a service call for a page; authorization/404 errors become a 404 page (no information leak). */
export async function load<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof AppError && (err.status === 403 || err.status === 404)) notFound();
    throw err;
  }
}

/** Page-level capability gate (the services check again on every call). */
export function requireCap(ok: boolean): void {
  if (!ok) notFound();
}
