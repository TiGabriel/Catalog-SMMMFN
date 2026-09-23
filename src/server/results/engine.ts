import type { RuleDefinition } from "@/server/results/rules";

/**
 * Pure module-result calculation (no DB access – fully unit-testable).
 * Produces, per student: current mean and final grade per subject, the module
 * exam grade, practical training, conduct and the module average, plus the
 * list of missing items when a result cannot be computed yet.
 */

export type EngineSubject = {
  id: string;
  name: string;
  type: "GENERAL" | "SPECIALIZATION" | "PRACTICAL_TRAINING" | "CONDUCT";
  hasFinalExam: boolean;
  weight: number | null;
};

export type EngineGrade = {
  studentId: string;
  subjectId: string;
  kind: "CURRENT" | "MODULE_EXAM" | "FINAL";
  value: number;
  gradeDate: Date;
  createdAt: Date;
};

export type EngineStudent = { id: string; firstName: string; lastName: string };

export type SubjectResult = {
  subjectId: string;
  currentCount: number;
  currentMean: number | null;
  exam: number | null;
  final: number | null;
};

export type StudentResult = {
  studentId: string;
  firstName: string;
  lastName: string;
  subjects: SubjectResult[];
  practicalTraining: number | null;
  conduct: number | null;
  moduleAverage: number | null;
  complete: boolean;
  missing: string[];
};

export function roundGrade(value: number, rules: RuleDefinition["rounding"]): number {
  const f = 10 ** rules.decimals;
  // Work on a scaled integer to avoid binary floating-point artefacts (e.g. 8.675).
  const scaled = Number((value * f).toFixed(6));
  const r = rules.mode === "TRUNCATE" ? Math.trunc(scaled) : Math.round(scaled);
  return r / f;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function latest(grades: EngineGrade[]): EngineGrade | null {
  return (
    [...grades].sort((a, b) => b.gradeDate.getTime() - a.gradeDate.getTime() || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
  );
}

export function computeModuleResults(
  students: EngineStudent[],
  subjects: EngineSubject[],
  grades: EngineGrade[],
  rules: RuleDefinition,
): StudentResult[] {
  const graded = subjects.filter((s) => s.type !== "CONDUCT");
  const conductSubject = subjects.find((s) => s.type === "CONDUCT");

  return students.map((st) => {
    const mine = grades.filter((g) => g.studentId === st.id);
    const missing: string[] = [];

    const subjectResults: SubjectResult[] = graded.map((sub) => {
      const current = mine.filter((g) => g.subjectId === sub.id && g.kind === "CURRENT").map((g) => g.value);
      const exam = latest(mine.filter((g) => g.subjectId === sub.id && g.kind === "MODULE_EXAM"))?.value ?? null;
      const rawMean = mean(current);
      const currentMean = rawMean === null ? null : roundGrade(rawMean, rules.rounding);
      let final: number | null = null;
      if (current.length < Math.max(rules.subjectFinal.minCurrentGrades, 1)) {
        missing.push(`${sub.name}: note curente insuficiente`);
      } else {
        const base = rules.subjectFinal.roundCurrentMean ? currentMean! : rawMean!;
        if (rules.subjectFinal.strategy === "WEIGHTED_WITH_EXAM" && sub.hasFinalExam) {
          if (exam === null) missing.push(`${sub.name}: lipsește examenul de modul`);
          else final = roundGrade(base * (1 - rules.subjectFinal.examWeight) + exam * rules.subjectFinal.examWeight, rules.rounding);
        } else {
          final = roundGrade(base, rules.rounding);
        }
      }
      return { subjectId: sub.id, currentCount: current.length, currentMean, exam, final };
    });

    let conduct: number | null = null;
    if (conductSubject) {
      const cg = mine.filter((g) => g.subjectId === conductSubject.id);
      if (cg.length) {
        conduct = rules.conduct.strategy === "LAST" ? latest(cg)!.value : roundGrade(mean(cg.map((g) => g.value))!, rules.rounding);
      } else if (rules.conduct.includeInModuleAverage) {
        missing.push("Purtare: lipsește nota");
      }
    }

    const practicalIds = new Set(graded.filter((s) => s.type === "PRACTICAL_TRAINING").map((s) => s.id));
    const practicalFinals = subjectResults.filter((r) => practicalIds.has(r.subjectId)).map((r) => r.final);
    const practicalTraining =
      practicalFinals.length && practicalFinals.every((v) => v !== null)
        ? roundGrade(mean(practicalFinals as number[])!, rules.rounding)
        : null;

    // Items that enter the module average, with their weights.
    const items: { value: number | null; weight: number }[] = [];
    for (const r of subjectResults) {
      const sub = graded.find((s) => s.id === r.subjectId)!;
      if (sub.type === "PRACTICAL_TRAINING" && !rules.practicalTraining.includeInModuleAverage) continue;
      items.push({ value: r.final, weight: rules.moduleAverage.strategy === "WEIGHTED_BY_MODULE_SUBJECT" ? (sub.weight ?? 1) : 1 });
    }
    if (conductSubject && rules.conduct.includeInModuleAverage) items.push({ value: conduct, weight: 1 });

    let moduleAverage: number | null = null;
    const totalWeight = items.reduce((a, i) => a + i.weight, 0);
    if (items.length && items.every((i) => i.value !== null) && totalWeight > 0) {
      moduleAverage = roundGrade(items.reduce((a, i) => a + i.value! * i.weight, 0) / totalWeight, rules.rounding);
    }

    return {
      studentId: st.id,
      firstName: st.firstName,
      lastName: st.lastName,
      subjects: subjectResults,
      practicalTraining,
      conduct,
      moduleAverage,
      complete: moduleAverage !== null && missing.length === 0,
      missing,
    };
  });
}
