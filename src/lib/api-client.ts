"use client";

/**
 * Minimal JSON client for the app's own API. Same-origin only; cookies are sent
 * automatically and the browser adds the Origin header checked by the server.
 */
export type ApiError = { code: string; message: string; details?: Record<string, string[]> };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: json as T };
    // Expired/missing session → back to the login page. Wrong credentials (also 401) must stay on the form.
    if (res.status === 401 && json?.error?.code === "NEAUTENTIFICAT" && typeof window !== "undefined") {
      window.location.assign(new URL("/autentificare", window.location.origin));
    }
    return {
      ok: false,
      status: res.status,
      error: json?.error ?? { code: "EROARE", message: "A apărut o eroare. Încercați din nou." },
    };
  } catch {
    return { ok: false, status: 0, error: { code: "RETEA", message: "Serverul nu poate fi contactat. Verificați conexiunea." } };
  }
}

export function firstErrors(err: ApiError): string[] {
  const details = err.details ? Object.values(err.details).flat() : [];
  return details.length ? details : [err.message];
}
