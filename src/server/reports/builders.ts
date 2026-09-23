import "server-only";
import { db } from "@/server/db/client";
import { Errors } from "@/server/errors";
import { assertPermission, denyWith, getClassAccess, getStudentAccess, hasPermission, subjectVisible } from "@/server/authz/policy";
import { loadScope } from "@/server/authz/scope";
import { actorDisplayName, type Actor } from "@/server/authz/actor";
import { computeClassModule, getActiveRuleSet, getModuleResults, type ModuleResultTable } from "@/server/domain/results";
import { roundGrade } from "@/server/results/engine";
import type { Cell, Report, ReportSection } from "@/server/reports/types";

/**
 * Report builders. Every builder authorizes through the same policies as the
 * catalog (class/student access, subject visibility), so a teacher can never
 * export another class or subject – no matter which parameters are sent.
 */

const fmtDate = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join(".");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
const studentName = (s: { lastName: string; firstName: string }) => `${s.lastName} ${s.firstName}`;

function base(actor: Actor, type: Report["type"], title: string, subtitle?: string): Omit<Report, "sections"> {
  return { type, title, subtitle, generatedAt: new Date().toISOString(), generatedBy: actorDisplayName(actor) };
}

async function classInfo(classSectionId: string) {
  return db.classSection.findUniqueOrThrow({
    where: { id: classSectionId },
    select: {
      id: true,
      code: true,
      yearOfStudy: true,
      academicYearId: true,
      company: { select: { name: true } },
      academicYear: { select: { id: true, name: true, status: true } },
    },
  });
}

async function classRoster(classSectionId: string) {
  const rows = await db.enrollment.findMany({
    where: { classSectionId, status: { notIn: ["WITHDRAWN", "TRANSFERRED"] } },
    select: { student: { select: { id: true, firstName: true, lastName: true, registryNumber: true } } },
    orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
  });
  return rows.map((r) => r.student);
}

/** Subjects of a class that the actor may see (taught or graded in the class, plus conduct). */
async function visibleSubjects(actor: Actor, classSectionId: string) {
  const access = await getClassAccess(actor, classSectionId);
  if (access.gradeSubjects !== "ALL" && access.gradeSubjects.size === 0) {
    return denyWith(actor, "notFound", { resource: "ReportClass", classSectionId });
  }
  const [taught, graded] = await Promise.all([
    db.teachingAssignment.findMany({ where: { classSectionId }, select: { subjectId: true } }),
    db.grade.findMany({ where: { classSectionId }, select: { subjectId: true }, distinct: ["subjectId"] }),
  ]);
  const ids = new Set([...taught.map((t) => t.subjectId), ...graded.map((g) => g.subjectId)]);
  const subjects = await db.subject.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, type: true }, orderBy: { name: "asc" } });
  return { access, subjects: subjects.filter((s) => subjectVisible(access, s.id)) };
}

// ───────────── 1. Catalogul clasei ─────────────

export async function classCatalogReport(actor: Actor, classSectionId: string): Promise<Report> {
  const { subjects } = await visibleSubjects(actor, classSectionId);
  const cls = await classInfo(classSectionId);
  const [students, grades] = await Promise.all([
    classRoster(classSectionId),
    db.grade.findMany({
      where: { classSectionId, status: "ACTIVE", subjectId: { in: subjects.map((s) => s.id) } },
      select: { studentId: true, subjectId: true, kind: true, value: true, gradeDate: true, module: { select: { name: true } } },
      orderBy: [{ gradeDate: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const sections: ReportSection[] = subjects.map((s) => {
    const rows: Cell[][] = students.map((st, i) => {
      const mine = grades.filter((g) => g.subjectId === s.id && g.studentId === st.id);
      const current = mine.filter((g) => g.kind === "CURRENT").map((g) => Number(g.value));
      const exam = mine.filter((g) => g.kind === "MODULE_EXAM").map((g) => `${Number(g.value)} (${g.module?.name ?? ""})`);
      const finals = mine.filter((g) => g.kind === "FINAL").map((g) => `${Number(g.value)} (${g.module?.name ?? ""})`);
      return [
        i + 1,
        studentName(st),
        s.type === "CONDUCT" ? finals.join("; ") || null : mine.filter((g) => g.kind === "CURRENT").map((g) => `${Number(g.value)} (${fmtDate(g.gradeDate)})`).join("; ") || null,
        s.type === "CONDUCT" ? null : exam.join("; ") || null,
        s.type === "CONDUCT" ? null : r2(mean(current)),
      ];
    });
    return {
      title: s.name,
      columns: [
        { label: "Nr.", numeric: true, width: 5 },
        { label: "Elev", width: 28 },
        { label: s.type === "CONDUCT" ? "Note purtare" : "Note curente (data)", width: 60 },
        { label: "Examen modul", width: 18 },
        { label: "Media notelor (informativ)", numeric: true, width: 14 },
      ],
      rows,
    };
  });
  return {
    ...base(actor, "catalog-clasa", `Catalogul clasei ${cls.code}`, `${cls.company.name} · an școlar ${cls.academicYear.name}`),
    sections: sections.length ? sections : [{ columns: [{ label: "Informație" }], rows: [["Nu există materii vizibile."]] }],
  };
}

// ───────────── 2. Medii pe materii ─────────────

export async function classAveragesReport(actor: Actor, classSectionId: string): Promise<Report> {
  const { access, subjects } = await visibleSubjects(actor, classSectionId);
  const graded = subjects.filter((s) => s.type !== "CONDUCT");
  const cls = await classInfo(classSectionId);
  const [students, grades, ruleSet] = await Promise.all([
    classRoster(classSectionId),
    db.grade.findMany({
      where: { classSectionId, status: "ACTIVE", kind: "CURRENT", subjectId: { in: graded.map((s) => s.id) } },
      select: { studentId: true, subjectId: true, value: true },
    }),
    getActiveRuleSet(db, cls.academicYearId),
  ]);
  const showGeneral = access.gradeSubjects === "ALL";
  const round = (x: number | null) => (x === null ? null : roundGrade(x, ruleSet.definition.rounding));
  const rows: Cell[][] = students.map((st, i) => {
    const means = graded.map((s) => round(mean(grades.filter((g) => g.studentId === st.id && g.subjectId === s.id).map((g) => Number(g.value)))));
    const valid = means.filter((m): m is number => m !== null);
    return [i + 1, studentName(st), ...means, ...(showGeneral ? [valid.length === means.length && valid.length ? round(mean(valid)) : null] : [])];
  });
  const classMeans: Cell[] = ["", "Media clasei", ...graded.map((_, j) => round(mean(rows.map((r) => r[j + 2]).filter((v): v is number => typeof v === "number"))))];
  if (showGeneral) classMeans.push(round(mean(rows.map((r) => r[r.length - 1]).filter((v): v is number => typeof v === "number"))));
  return {
    ...base(actor, "medii-clasa", `Medii pe materii – clasa ${cls.code}`, `An școlar ${cls.academicYear.name} · media notelor curente (toate modulele)`),
    provisional: true,
    notes: ["Mediile sunt informative (media aritmetică a notelor curente); mediile oficiale se calculează pe module, după regulile configurate."],
    sections: [
      {
        columns: [
          { label: "Nr.", numeric: true, width: 5 },
          { label: "Elev", width: 28 },
          ...graded.map((s) => ({ label: s.name, numeric: true, width: 14 })),
          ...(showGeneral ? [{ label: "Media generală", numeric: true, width: 14 }] : []),
        ],
        rows: [...rows, classMeans],
      },
    ],
  };
}

// ───────────── 3. Rezultatele modulului ─────────────

function moduleSection(t: ModuleResultTable): ReportSection {
  const regular = t.subjects.filter((s) => s.type !== "CONDUCT" && s.type !== "PRACTICAL_TRAINING");
  const hasPractical = t.subjects.some((s) => s.type === "PRACTICAL_TRAINING");
  return {
    columns: [
      { label: "Nr.", numeric: true, width: 5 },
      { label: "Elev", width: 28 },
      ...regular.map((s) => ({ label: s.name + (s.hasFinalExam ? " *" : ""), numeric: true, width: 12 })),
      ...(hasPractical ? [{ label: "Instruire practică", numeric: true, width: 12 }] : []),
      { label: "Purtare", numeric: true, width: 10 },
      { label: "Media modulului", numeric: true, width: 12 },
      { label: "Observații", width: 40 },
    ],
    rows: t.rows.map((r, i) => [
      i + 1,
      `${r.lastName} ${r.firstName}`,
      ...regular.map((s) => r.subjects.find((x) => x.subjectId === s.id)?.final ?? null),
      ...(hasPractical ? [r.practicalTraining] : []),
      r.conduct,
      r.moduleAverage,
      r.missing.join("; ") || null,
    ]),
    note: "* materie cu examen final de modul",
  };
}

export async function moduleResultsReport(actor: Actor, classSectionId: string, moduleId: string): Promise<Report> {
  const t = await getModuleResults(actor, classSectionId, moduleId);
  const cls = await classInfo(classSectionId);
  return {
    ...base(actor, "rezultate-modul", `Rezultatele modulului – ${t.module.name}, clasa ${t.classSection.code}`, `An școlar ${cls.academicYear.name} · ${t.frozen ? "rezultate finale (modul închis)" : "calcul provizoriu"} · reguli: ${t.ruleSet.name}`),
    provisional: t.ruleSet.provisional || !t.frozen,
    sections: [moduleSection(t)],
  };
}

// ───────────── 4. Rezultatele anului școlar ─────────────

async function classModuleTables(actor: Actor, classSectionId: string) {
  const cls = await classInfo(classSectionId);
  const modules = await db.module.findMany({
    where: { academicYearId: cls.academicYearId, yearOfStudy: cls.yearOfStudy },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  const tables: ModuleResultTable[] = [];
  for (const m of modules) tables.push(await getModuleResults(actor, classSectionId, m.id));
  return { cls, tables };
}

export async function yearResultsReport(actor: Actor, classSectionId: string): Promise<Report> {
  const access = await getClassAccess(actor, classSectionId);
  if (access.gradeSubjects !== "ALL") return denyWith(actor, "notFound", { resource: "YearResults", classSectionId });
  const { cls, tables } = await classModuleTables(actor, classSectionId);
  const ruleSet = await getActiveRuleSet(db, cls.academicYearId);
  const students = await classRoster(classSectionId);
  const rows: Cell[][] = students.map((st, i) => {
    const avgs = tables.map((t) => t.rows.find((r) => r.studentId === st.id)?.moduleAverage ?? null);
    const conduct = tables.map((t) => t.rows.find((r) => r.studentId === st.id)?.conduct ?? null);
    const present = avgs.filter((v): v is number => v !== null);
    const complete = ruleSet.definition.annualAverage.requireAllModules ? present.length === avgs.length : present.length > 0;
    const annual = complete && present.length ? roundGrade(mean(present)!, ruleSet.definition.rounding) : null;
    return [i + 1, studentName(st), ...avgs, ...conduct, annual];
  });
  return {
    ...base(actor, "rezultate-an", `Rezultatele anului școlar – clasa ${cls.code}`, `${cls.company.name} · an școlar ${cls.academicYear.name}`),
    provisional: true,
    notes: [`Media anuală: media mediilor de modul (${ruleSet.name}); regulile oficiale pot modifica modul de calcul.`],
    sections: [
      {
        columns: [
          { label: "Nr.", numeric: true, width: 5 },
          { label: "Elev", width: 28 },
          ...tables.map((t) => ({ label: `Media ${t.module.name}`, numeric: true, width: 12 })),
          ...tables.map((t) => ({ label: `Purtare ${t.module.name}`, numeric: true, width: 12 })),
          { label: "Media anuală", numeric: true, width: 12 },
        ],
        rows,
      },
    ],
  };
}

// ───────────── 5. Situația școlară a elevului ─────────────

export async function studentSituationReport(actor: Actor, studentId: string): Promise<Report> {
  const access = await getStudentAccess(actor, studentId);
  if (access.gradeSubjects !== "ALL" && access.gradeSubjects.size === 0) return denyWith(actor, "notFound", { resource: "StudentReport", studentId });
  const student = await db.student.findUniqueOrThrow({
    where: { id: studentId },
    select: {
      firstName: true,
      lastName: true,
      registryNumber: true,
      enrollments: { where: { academicYear: { status: "ACTIVE" } }, select: { classSection: { select: { id: true, code: true } }, academicYear: { select: { name: true } } } },
    },
  });
  const enrollment = student.enrollments[0];
  const grades = await db.grade.findMany({
    where: {
      studentId,
      status: "ACTIVE",
      academicYear: { status: "ACTIVE" },
      ...(access.gradeSubjects === "ALL" ? {} : { subjectId: { in: [...access.gradeSubjects] }, classSectionId: { in: access.classSectionIds } }),
    },
    select: { kind: true, value: true, gradeDate: true, subject: { select: { id: true, name: true, type: true } }, module: { select: { id: true, name: true, order: true } }, reason: { select: { label: true } } },
    orderBy: [{ subject: { name: "asc" } }, { gradeDate: "asc" }],
  });
  const keys = new Map<string, { subject: string; module: string; order: number; list: typeof grades }>();
  for (const g of grades) {
    const k = `${g.subject.id}|${g.module?.id ?? ""}`;
    const e = keys.get(k) ?? { subject: g.subject.name, module: g.module?.name ?? "—", order: g.module?.order ?? 0, list: [] };
    e.list.push(g);
    keys.set(k, e);
  }
  const rows: Cell[][] = [...keys.values()]
    .sort((a, b) => a.subject.localeCompare(b.subject, "ro") || a.order - b.order)
    .map((e) => {
      const current = e.list.filter((g) => g.kind === "CURRENT");
      return [
        e.subject,
        e.module,
        current.map((g) => `${Number(g.value)} (${g.reason?.label ?? ""}, ${fmtDate(g.gradeDate)})`).join("; ") || null,
        e.list.filter((g) => g.kind === "MODULE_EXAM").map((g) => Number(g.value)).join(", ") || null,
        e.list.filter((g) => g.kind === "FINAL").map((g) => Number(g.value)).join(", ") || null,
        r2(mean(current.map((g) => Number(g.value)))),
      ];
    });
  return {
    ...base(actor, "situatie-elev", `Situația școlară – ${studentName(student)}`, `${enrollment ? `Clasa ${enrollment.classSection.code} · an școlar ${enrollment.academicYear.name} · ` : ""}nr. matricol ${student.registryNumber ?? "—"}`),
    sections: [
      {
        columns: [
          { label: "Materie", width: 24 },
          { label: "Modul", width: 14 },
          { label: "Note curente", width: 60 },
          { label: "Examen", numeric: true, width: 10 },
          { label: "Notă finală", numeric: true, width: 10 },
          { label: "Media notelor (informativ)", numeric: true, width: 14 },
        ],
        rows: rows.length ? rows : [["Nu există note înregistrate.", null, null, null, null, null]],
      },
    ],
  };
}

// ───────────── 6. Foaie matricolă (istoric academic) ─────────────

export async function transcriptReport(actor: Actor, studentId: string): Promise<Report> {
  // Full history across years: commander, or the student themself (when student accounts are enabled).
  if (!hasPermission(actor, "academic.read.all")) {
    await assertPermission(actor, "self.academic.read");
    const scope = await loadScope(actor);
    if (scope.studentId !== studentId) return denyWith(actor, "notFound", { resource: "Transcript", studentId });
  }
  const student = await db.student.findUnique({
    where: { id: studentId },
    select: {
      firstName: true,
      lastName: true,
      registryNumber: true,
      status: true,
      enrollments: {
        orderBy: { startDate: "asc" },
        select: { status: true, classSection: { select: { id: true, code: true, yearOfStudy: true, academicYearId: true } }, academicYear: { select: { name: true } } },
      },
    },
  });
  if (!student) throw Errors.notFound();
  const rows: Cell[][] = [];
  for (const e of student.enrollments) {
    const modules = await db.module.findMany({
      where: { academicYearId: e.classSection.academicYearId, yearOfStudy: e.classSection.yearOfStudy },
      orderBy: { order: "asc" },
    });
    for (const m of modules) {
      const snap = await db.moduleResultSnapshot.findUnique({ where: { moduleId_classSectionId: { moduleId: m.id, classSectionId: e.classSection.id } } });
      const table = snap ? (snap.data as unknown as ModuleResultTable) : await computeClassModule(db, e.classSection.id, m.id);
      const r = table.rows.find((x) => x.studentId === studentId);
      rows.push([
        e.academicYear.name,
        e.classSection.code,
        m.name,
        r?.moduleAverage ?? null,
        r?.conduct ?? null,
        r?.practicalTraining ?? null,
        snap ? "final" : "provizoriu",
      ]);
    }
    if (modules.length === 0) rows.push([e.academicYear.name, e.classSection.code, "—", null, null, null, null]);
  }
  const statusLabel: Record<string, string> = { ACTIVE: "activ", GRADUATED: "absolvent", WITHDRAWN: "retras", SUSPENDED: "suspendat" };
  return {
    ...base(actor, "foaie-matricola", `Foaie matricolă – ${studentName(student)}`, `Nr. matricol ${student.registryNumber ?? "—"} · stare: ${statusLabel[student.status] ?? student.status}`),
    sections: [
      {
        columns: [
          { label: "An școlar", width: 12 },
          { label: "Clasa", width: 8 },
          { label: "Modul", width: 14 },
          { label: "Media modulului", numeric: true, width: 12 },
          { label: "Purtare", numeric: true, width: 10 },
          { label: "Instruire practică", numeric: true, width: 12 },
          { label: "Rezultat", width: 12 },
        ],
        rows: rows.length ? rows : [["—", null, null, null, null, null, null]],
      },
    ],
  };
}

// ───────────── 7. Situația generală a școlii ─────────────

export async function generalSituationReport(actor: Actor, academicYearId?: string): Promise<Report> {
  await assertPermission(actor, "academic.read.all");
  const year = academicYearId
    ? await db.academicYear.findUnique({ where: { id: academicYearId } })
    : await db.academicYear.findFirst({ where: { status: "ACTIVE" } });
  if (!year) throw Errors.notFound();
  const classes = await db.classSection.findMany({
    where: { academicYearId: year.id },
    select: { id: true, code: true, yearOfStudy: true, company: { select: { name: true } } },
    orderBy: [{ company: { number: "asc" } }, { code: "asc" }],
  });
  const rows: Cell[][] = [];
  for (const c of classes) {
    const [students, gradeCount, modules] = await Promise.all([
      db.enrollment.count({ where: { classSectionId: c.id, status: { notIn: ["WITHDRAWN", "TRANSFERRED"] } } }),
      db.grade.count({ where: { classSectionId: c.id, status: "ACTIVE" } }),
      db.module.findMany({ where: { academicYearId: year.id, yearOfStudy: c.yearOfStudy, status: { not: "PLANNED" } }, orderBy: { order: "desc" }, take: 1 }),
    ]);
    let classMean: number | null = null;
    let under5 = 0;
    let moduleName = "—";
    if (modules[0] && students > 0) {
      const t = await getModuleResults(actor, c.id, modules[0].id);
      moduleName = t.module.name;
      const avgs = t.rows.map((r) => r.moduleAverage).filter((v): v is number => v !== null);
      classMean = r2(mean(avgs));
      under5 = avgs.filter((v) => v < 5).length;
    }
    rows.push([c.company.name, c.code, students, gradeCount, moduleName, classMean, under5]);
  }
  return {
    ...base(actor, "situatie-generala", "Situația generală a școlii", `An școlar ${year.name}`),
    provisional: true,
    notes: ["Media clasei este media mediilor de modul disponibile pentru cel mai recent modul deschis sau închis."],
    sections: [
      {
        columns: [
          { label: "Companie", width: 14 },
          { label: "Clasa", width: 8 },
          { label: "Elevi", numeric: true, width: 8 },
          { label: "Note înregistrate", numeric: true, width: 12 },
          { label: "Modul", width: 14 },
          { label: "Media clasei", numeric: true, width: 12 },
          { label: "Elevi cu media sub 5", numeric: true, width: 14 },
        ],
        rows,
      },
    ],
  };
}
