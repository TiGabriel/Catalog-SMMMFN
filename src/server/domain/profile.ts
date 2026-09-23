import "server-only";
import { hasPermission } from "@/server/authz/policy";
import { loadScope } from "@/server/authz/scope";
import type { Actor } from "@/server/authz/actor";

/**
 * Capability flags for the UI. They only drive navigation/visibility – every
 * action is still authorized on the server. The internal role name is never
 * returned (normal users must not see their own role).
 */
export type Capabilities = {
  administrare: boolean;
  audit: boolean;
  catalogGeneral: boolean;
  claseleMele: boolean;
  diriginte: boolean;
  orar: boolean;
  noteleMele: boolean;
  introducereNote: boolean;
  cereriCorectie: boolean;
  aprobaCorecturi: boolean;
  rapoarte: boolean;
};

export async function getCapabilities(actor: Actor): Promise<Capabilities> {
  const scoped = hasPermission(actor, "academic.read.scoped");
  const scope = scoped ? await loadScope(actor) : null;
  return {
    administrare: hasPermission(actor, "users.manage"),
    audit: hasPermission(actor, "audit.read"),
    catalogGeneral: hasPermission(actor, "academic.read.all"),
    claseleMele: scoped,
    diriginte: !!scope && scope.homeroomClassIds.size > 0,
    orar: hasPermission(actor, "timetable.read.all") || hasPermission(actor, "timetable.read.own"),
    noteleMele: hasPermission(actor, "self.academic.read"),
    introducereNote: hasPermission(actor, "grades.create.scoped"),
    cereriCorectie: hasPermission(actor, "corrections.request") || hasPermission(actor, "corrections.review"),
    aprobaCorecturi: hasPermission(actor, "corrections.review"),
    rapoarte: hasPermission(actor, "academic.read.all") || (!!scope && scope.homeroomClassIds.size > 0) || scoped,
  };
}

export async function getProfile(actor: Actor) {
  return {
    firstName: actor.firstName,
    lastName: actor.lastName,
    rank: actor.rankLabel,
    mustChangePassword: actor.mustChangePassword,
    capabilities: await getCapabilities(actor),
  };
}
