/**
 * Base structure of the school (idempotent). Used by `npm run db:seed` and by the tests.
 * Everything seeded here stays editable later through the administrator interface.
 */
import type { PrismaClient } from "../src/generated/prisma/client";

export const CLASS_SUFFIXES = ["11", "12", "13", "14", "15", "24", "25"] as const;

const RANKS: { code: string; label: string; category: string }[] = [
  { code: "ELEV", label: "Elev", category: "elev" },
  { code: "SERG", label: "Sergent", category: "subofițer" },
  { code: "SERG_MAJ", label: "Sergent major", category: "subofițer" },
  { code: "PLT", label: "Plutonier", category: "subofițer" },
  { code: "PLT_MAJ", label: "Plutonier major", category: "subofițer" },
  { code: "PLT_ADJ", label: "Plutonier adjutant", category: "subofițer" },
  { code: "PLT_ADJ_PR", label: "Plutonier adjutant principal", category: "subofițer" },
  { code: "MM5", label: "Maistru militar clasa a V-a", category: "maistru militar" },
  { code: "MM4", label: "Maistru militar clasa a IV-a", category: "maistru militar" },
  { code: "MM3", label: "Maistru militar clasa a III-a", category: "maistru militar" },
  { code: "MM2", label: "Maistru militar clasa a II-a", category: "maistru militar" },
  { code: "MM1", label: "Maistru militar clasa I", category: "maistru militar" },
  { code: "MMP", label: "Maistru militar principal", category: "maistru militar" },
  { code: "ASP", label: "Aspirant", category: "ofițer" },
  { code: "LT", label: "Locotenent", category: "ofițer" },
  { code: "CPT_LT", label: "Căpitan-locotenent", category: "ofițer" },
  { code: "LT_CDOR", label: "Locotenent-comandor", category: "ofițer" },
  { code: "CPT_CDOR", label: "Căpitan-comandor", category: "ofițer" },
  { code: "CDOR", label: "Comandor", category: "ofițer" },
  { code: "CAM_FLT", label: "Contraamiral de flotilă", category: "ofițer" },
  { code: "CAM", label: "Contraamiral", category: "ofițer" },
];

const GRADE_REASONS = [
  { code: "TESTARE", label: "Testare", appliesTo: ["CURRENT"] },
  { code: "ASCULTARE", label: "Ascultare", appliesTo: ["CURRENT"] },
  { code: "ACTIVITATE_CLASA", label: "Activitate la clasă", appliesTo: ["CURRENT"] },
  { code: "CAIET", label: "Caiet", appliesTo: ["CURRENT"] },
  { code: "PROIECT", label: "Proiect", appliesTo: ["CURRENT"] },
  { code: "ALTA_ACTIVITATE", label: "Altă activitate", appliesTo: ["CURRENT"] },
  { code: "EXAMEN_MODUL", label: "Examen final de modul", appliesTo: ["MODULE_EXAM"] },
  { code: "NOTA_PURTARE", label: "Notă la purtare", appliesTo: ["FINAL"] },
] as const;

/** Default bell schedule – to be confirmed by the school. */
const TIME_SLOTS = [
  ["08:00", "08:50"],
  ["09:00", "09:50"],
  ["10:00", "10:50"],
  ["11:00", "11:50"],
  ["12:00", "12:50"],
  ["13:00", "13:50"],
  ["14:00", "14:50"],
] as const;

/** The school year that contains `today` (1 September – 31 August). */
export function currentSchoolYear(today = new Date()) {
  const start = today.getUTCMonth() >= 8 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  return {
    startYear: start,
    name: `${start}–${start + 1}`,
    startDate: new Date(Date.UTC(start, 8, 1)),
    endDate: new Date(Date.UTC(start + 1, 7, 31)),
  };
}

export async function seedBase(prisma: PrismaClient) {
  for (const [i, r] of RANKS.entries()) {
    await prisma.rank.upsert({ where: { code: r.code }, create: { ...r, sortOrder: i }, update: {} });
  }

  const c1 = await prisma.company.upsert({
    where: { number: 1 },
    create: { number: 1, name: "Compania 1", yearOfStudy: 2 },
    update: {},
  });
  const c2 = await prisma.company.upsert({
    where: { number: 2 },
    create: { number: 2, name: "Compania 2", yearOfStudy: 1 },
    update: {},
  });

  const sy = currentSchoolYear();
  let year = await prisma.academicYear.findUnique({ where: { name: sy.name } });
  if (!year) {
    const hasActive = await prisma.academicYear.findFirst({ where: { status: "ACTIVE" } });
    year = await prisma.academicYear.create({
      data: { name: sy.name, startDate: sy.startDate, endDate: sy.endDate, status: hasActive ? "PLANNED" : "ACTIVE" },
    });
  }

  // Year II classes (Compania 1) belong to the cohort that entered last year; year I (Compania 2) to this year's.
  for (const yearOfStudy of [2, 1] as const) {
    const company = yearOfStudy === 2 ? c1 : c2;
    const startYear = sy.startYear - (yearOfStudy - 1);
    for (const suffix of CLASS_SUFFIXES) {
      const cohort = await prisma.cohort.upsert({
        where: { startYear_suffix: { startYear, suffix } },
        create: { startYear, suffix, name: `Promoția ${startYear}–${startYear + 2} / ${suffix}` },
        update: {},
      });
      const code = `${yearOfStudy}${suffix}`;
      await prisma.classSection.upsert({
        where: { academicYearId_code: { academicYearId: year.id, code } },
        create: { academicYearId: year.id, cohortId: cohort.id, companyId: company.id, yearOfStudy, code },
        update: {},
      });
    }
  }

  await prisma.subject.upsert({
    where: { code: "PURTARE" },
    create: { code: "PURTARE", name: "Purtare", type: "CONDUCT", isSystem: true },
    update: {},
  });
  await prisma.subject.upsert({
    where: { code: "INSTR_PRACTICA" },
    create: { code: "INSTR_PRACTICA", name: "Instruire practică", type: "PRACTICAL_TRAINING" },
    update: {},
  });

  for (const [i, r] of GRADE_REASONS.entries()) {
    await prisma.gradeReason.upsert({
      where: { code: r.code },
      create: { code: r.code, label: r.label, appliesTo: [...r.appliesTo], sortOrder: i },
      update: {},
    });
  }

  for (const [i, [startTime, endTime]] of TIME_SLOTS.entries()) {
    await prisma.timeSlot.upsert({ where: { index: i + 1 }, create: { index: i + 1, startTime, endTime }, update: {} });
  }

  return { academicYear: year };
}
