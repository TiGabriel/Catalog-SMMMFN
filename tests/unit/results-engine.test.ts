import { describe, expect, it } from "vitest";
import { computeModuleResults, roundGrade, type EngineGrade, type EngineSubject } from "@/server/results/engine";
import { PROVISIONAL_RULES, ruleDefinitionSchema, type RuleDefinition } from "@/server/results/rules";

const d = new Date("2026-10-01");
const g = (studentId: string, subjectId: string, value: number, kind: EngineGrade["kind"] = "CURRENT"): EngineGrade => ({
  studentId,
  subjectId,
  value,
  kind,
  gradeDate: d,
  createdAt: d,
});
const subjects: EngineSubject[] = [
  { id: "mat", name: "Matematică", type: "GENERAL", hasFinalExam: true, weight: 2 },
  { id: "eng", name: "Engleză", type: "GENERAL", hasFinalExam: false, weight: 1 },
  { id: "ip", name: "Instruire practică", type: "PRACTICAL_TRAINING", hasFinalExam: false, weight: 1 },
  { id: "p", name: "Purtare", type: "CONDUCT", hasFinalExam: false, weight: null },
];
const students = [{ id: "s1", firstName: "A", lastName: "B" }];

describe("motorul de calcul al rezultatelor (configurabil)", () => {
  it("rotunjire HALF_UP / TRUNCATE fără artefacte de virgulă mobilă", () => {
    expect(roundGrade(8.675, { decimals: 2, mode: "HALF_UP" })).toBe(8.68);
    expect(roundGrade(8.679, { decimals: 2, mode: "TRUNCATE" })).toBe(8.67);
    expect(roundGrade(9.5, { decimals: 0, mode: "HALF_UP" })).toBe(10);
  });

  it("regulile provizorii: medie ponderată cu examenul, purtare separată, practică inclusă", () => {
    const [r] = computeModuleResults(
      students,
      subjects,
      [g("s1", "mat", 8), g("s1", "mat", 9), g("s1", "mat", 10, "MODULE_EXAM"), g("s1", "eng", 7), g("s1", "ip", 10), g("s1", "p", 10, "FINAL")],
      PROVISIONAL_RULES,
    );
    const mat = r!.subjects.find((s) => s.subjectId === "mat")!;
    expect(mat.currentMean).toBe(8.5);
    expect(mat.final).toBe(9.25); // 8.5 * 0.5 + 10 * 0.5
    expect(r!.practicalTraining).toBe(10);
    expect(r!.conduct).toBe(10);
    expect(r!.moduleAverage).toBe(8.75); // (9.25 + 7 + 10) / 3
    expect(r!.complete).toBe(true);
  });

  it("raportează elementele lipsă în loc să calculeze o medie greșită", () => {
    const [r] = computeModuleResults(students, subjects, [g("s1", "mat", 8), g("s1", "ip", 9)], PROVISIONAL_RULES);
    expect(r!.moduleAverage).toBeNull();
    expect(r!.complete).toBe(false);
    expect(r!.missing.join(" ")).toMatch(/examenul de modul/);
    expect(r!.missing.join(" ")).toMatch(/Engleză/);
  });

  it("regulile pot fi schimbate fără cod nou: ponderi pe materie și purtare inclusă", () => {
    const rules: RuleDefinition = {
      ...PROVISIONAL_RULES,
      subjectFinal: { ...PROVISIONAL_RULES.subjectFinal, strategy: "MEAN_CURRENT" },
      conduct: { strategy: "LAST", includeInModuleAverage: true },
      practicalTraining: { includeInModuleAverage: false },
      moduleAverage: { strategy: "WEIGHTED_BY_MODULE_SUBJECT" },
    };
    const [r] = computeModuleResults(students, subjects, [g("s1", "mat", 10), g("s1", "eng", 7), g("s1", "ip", 5), g("s1", "p", 10, "FINAL")], rules);
    // (10*2 + 7*1 + 10*1) / 4 = 9.25 ; practical excluded
    expect(r!.moduleAverage).toBe(9.25);
  });

  it("definițiile invalide sunt respinse", () => {
    expect(ruleDefinitionSchema.safeParse({ ...PROVISIONAL_RULES, rounding: { decimals: 9, mode: "X" } }).success).toBe(false);
    expect(ruleDefinitionSchema.safeParse(PROVISIONAL_RULES).success).toBe(true);
  });
});
