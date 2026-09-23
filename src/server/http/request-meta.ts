import "server-only";
import { randomUUID } from "node:crypto";
import { config } from "@/server/config";

export type RequestMeta = {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
};

/**
 * Client IP. X-Forwarded-For is only trusted when the app runs behind a
 * reverse proxy we control (TRUST_PROXY=true); we take the right-most entry,
 * i.e. the address our own proxy observed, which a client cannot spoof.
 */
export function clientIp(headers: Headers): string | null {
  if (!config().trustProxy) return null;
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last.length <= 64) return last;
  }
  const real = headers.get("x-real-ip");
  return real && real.length <= 64 ? real.trim() : null;
}

export function requestMetaFromHeaders(headers: Headers): RequestMeta {
  const ua = headers.get("user-agent");
  return {
    ip: clientIp(headers),
    userAgent: ua ? ua.slice(0, 300) : null,
    requestId: randomUUID(),
  };
}
