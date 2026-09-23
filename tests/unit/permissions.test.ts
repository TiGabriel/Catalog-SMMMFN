import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, roleHas } from "@/server/authz/permissions";
import { requiredAssignmentKind } from "@/server/authz/policy";

describe("matricea rol → permisiuni", () => {
  it("administratorul nu are nicio permisiune asupra notelor sau datelor academice", () => {
    for (const p of ROLE_PERMISSIONS.ADMINISTRATOR) {
      expect(p.startsWith("grades.") || p.startsWith("academic.") || p.startsWith("self.")).toBe(false);
    }
  });

  it("comandantul are acces de citire global, dar nu poate introduce note sau administra", () => {
    expect(roleHas("COMANDANT_UNITATE", "academic.read.all")).toBe(true);
    expect(roleHas("COMANDANT_UNITATE", "audit.read")).toBe(true);
    expect(roleHas("COMANDANT_UNITATE", "corrections.review")).toBe(true);
    for (const p of ["grades.create.scoped", "grades.conduct.scoped", "users.manage", "structure.manage", "assignments.manage", "config.manage"] as const) {
      expect(roleHas("COMANDANT_UNITATE", p)).toBe(false);
    }
  });

  it("profesorul are doar permisiuni limitate prin repartizări", () => {
    expect(ROLE_PERMISSIONS.PROFESOR.every((p) => p.endsWith(".scoped") || p.endsWith(".own") || p === "corrections.request")).toBe(true);
    expect(roleHas("PROFESOR", "audit.read")).toBe(false);
  });

  it("elevul vede doar propriile date și nu are acces la audit", () => {
    expect([...ROLE_PERMISSIONS.ELEV].sort()).toEqual(["self.academic.read", "timetable.read.own"]);
  });

  it("auditul este accesibil doar administratorului și comandantului", () => {
    const withAudit = Object.entries(ROLE_PERMISSIONS).filter(([, ps]) => ps.includes("audit.read")).map(([r]) => r).sort();
    expect(withAudit).toEqual(["ADMINISTRATOR", "COMANDANT_UNITATE"]);
  });

  it("tipul de repartizare cerut depinde de materie și tipul notei", () => {
    expect(requiredAssignmentKind("GENERAL", "CURRENT")).toBe("SUBJECT_TEACHING");
    expect(requiredAssignmentKind("PRACTICAL_TRAINING", "CURRENT")).toBe("PRACTICAL_TRAINING");
    expect(requiredAssignmentKind("SPECIALIZATION", "MODULE_EXAM")).toBe("MODULE_EXAM");
    expect(requiredAssignmentKind("CONDUCT", "FINAL")).toBe("HOMEROOM");
    expect(requiredAssignmentKind("CONDUCT", "CURRENT")).toBe(null);
    expect(requiredAssignmentKind("GENERAL", "FINAL")).toBe(null);
  });
});

describe("auditul de sistem", () => {
  it("doar administratorul are acces la auditul complet al sistemului", async () => {
    const { ROLE_PERMISSIONS: RP } = await import("@/server/authz/permissions");
    const roles = Object.entries(RP).filter(([, ps]) => ps.includes("audit.read.system")).map(([r]) => r);
    expect(roles).toEqual(["ADMINISTRATOR"]);
  });
});
