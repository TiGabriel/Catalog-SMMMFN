import "server-only";
import type { Role } from "@/generated/prisma/enums";
import type { RequestMeta } from "@/server/http/request-meta";

/**
 * The authenticated principal, always resolved on the server from the session
 * cookie and the database. Nothing here comes from client-supplied data.
 */
export type Actor = {
  userId: string;
  role: Role;
  firstName: string;
  lastName: string;
  rankLabel: string | null;
  mustChangePassword: boolean;
  /** Session id (SHA-256 of the token) – never the token itself. */
  sessionId: string;
  meta: RequestMeta;
};

export function actorDisplayName(a: Pick<Actor, "firstName" | "lastName" | "rankLabel">): string {
  return [a.rankLabel, a.lastName, a.firstName].filter(Boolean).join(" ");
}
