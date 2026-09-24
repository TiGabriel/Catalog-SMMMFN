/**
 * Demonstration data (development and automated tests only – never production).
 * Builds on the base structure from prisma/seed-lib.ts.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import type { Role, UserStatus } from "../src/generated/prisma/enums";

/** Password of the demo/test accounts – from the environment only (never hard-coded). */
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "";

export type DemoIds = Awaited<ReturnType<typeof seedDemo>>;

export async function seedDemo(prisma: PrismaClient, passwordHash: string) {
  if (!DEMO_PASSWORD) throw new Error("DEMO_PASSWORD lipsește din mediu.");
  const year = await prisma.academicYear.findFirstOrThrow({ where: { status: "ACTIVE" } });
  const cls = async (code: string) =>
    prisma.classSection.findUniqueOrThrow({ where: { academicYearId_code: { academicYearId: year.id, code } } });
  const [c111, c112, c113, c211] = await Promise.all([cls("111"), cls("112"), cls("113"), cls("211")]);

  const rank = async (code: string) => (await prisma.rank.findUniqueOrThrow({ where: { code } })).id;

  const user = async (username: string, firstName: string, lastName: string, role: Role, rankCode: string | null, status: UserStatus = "ACTIVE") =>
    prisma.user.upsert({
      where: { username },
      create: {
        username,
        firstName,
        lastName,
        role,
        status,
        rankId: rankCode ? await rank(rankCode) : null,
        passwordHash,
        mustChangePassword: false,
        deactivatedAt: status === "ACTIVE" ? null : new Date(),
      },
      update: {},
    });

  const admin = await user("admin.demo", "Mihai", "Constantinescu", "ADMINISTRATOR", "MM2");
  const comandant = await user("comandant.demo", "Radu", "Enache", "COMANDANT_UNITATE", "CDOR");
  const popescu = await user("prof.popescu", "Elena", "Popescu", "PROFESOR", null); // civilian contract staff
  const ionescu = await user("prof.ionescu", "Andrei", "Ionescu", "PROFESOR", "LT_CDOR");
  const georgescu = await user("prof.georgescu", "Ioana", "Georgescu", "PROFESOR", null);
  const inactiv = await user("prof.inactiv", "Vasile", "Munteanu", "PROFESOR", "CPT_LT", "INACTIVE");
  const elevA = await user("elev.marin", "Andrei", "Marin", "ELEV", "ELEV");
  const elevC = await user("elev.dobre", "Cristian", "Dobre", "ELEV", "ELEV");

  const subject = async (code: string, name: string, type: "GENERAL" | "SPECIALIZATION") =>
    prisma.subject.upsert({ where: { code }, create: { code, name, type }, update: {} });
  const mat = await subject("MAT", "Matematică", "GENERAL");
  const eng = await subject("ENG", "Limba engleză", "GENERAL");
  const nav = await subject("NAV", "Navigație", "SPECIALIZATION");
  const practica = await prisma.subject.findUniqueOrThrow({ where: { code: "INSTR_PRACTICA" } });
  const purtare = await prisma.subject.findUniqueOrThrow({ where: { code: "PURTARE" } });

  const mod1 = await prisma.module.upsert({
    where: { academicYearId_yearOfStudy_order: { academicYearId: year.id, yearOfStudy: 1, order: 1 } },
    create: { academicYearId: year.id, yearOfStudy: 1, name: "Modulul 1", order: 1, status: "OPEN", startDate: year.startDate },
    update: {},
  });

  const mod2 = await prisma.module.upsert({
    where: { academicYearId_yearOfStudy_order: { academicYearId: year.id, yearOfStudy: 2, order: 1 } },
    create: { academicYearId: year.id, yearOfStudy: 2, name: "Modulul 1", order: 1, status: "OPEN", startDate: year.startDate },
    update: {},
  });
  const plan = async (moduleId: string, subjectId: string, hasFinalExam = false) => {
    const exists = await prisma.moduleSubject.findFirst({ where: { moduleId, subjectId, specializationId: null } });
    if (!exists) await prisma.moduleSubject.create({ data: { moduleId, subjectId, hasFinalExam, weight: 1 } });
  };
  await plan(mod1.id, mat.id, true);
  await plan(mod1.id, eng.id);
  await plan(mod1.id, nav.id, true);
  await plan(mod1.id, practica.id);
  await plan(mod2.id, mat.id);
  await plan(mod2.id, eng.id);

  const student = async (registryNumber: string, firstName: string, lastName: string, classId: string, userId: string | null) => {
    const s = await prisma.student.upsert({
      where: { registryNumber },
      create: { registryNumber, firstName, lastName, userId, rankId: await rank("ELEV") },
      update: {},
    });
    const existing = await prisma.enrollment.findFirst({ where: { studentId: s.id, academicYearId: year.id } });
    if (!existing) {
      await prisma.enrollment.create({
        data: { studentId: s.id, classSectionId: classId, academicYearId: year.id, startDate: year.startDate },
      });
    }
    return s;
  };
  const sMarin = await student("M-0001", "Andrei", "Marin", c112.id, elevA.id);
  const sStan = await student("M-0002", "Bogdan", "Stan", c112.id, null);
  const sDobre = await student("M-0003", "Cristian", "Dobre", c113.id, elevC.id);
  const sVasile = await student("M-0004", "Dan", "Vasile", c111.id, null);
  const sPetre = await student("M-0005", "Florin", "Petre", c211.id, null);

  const assign = async (teacherId: string, classSectionId: string, subjectId: string, kind: "SUBJECT_TEACHING" | "PRACTICAL_TRAINING" | "MODULE_EXAM", ended = false) => {
    const existing = await prisma.teachingAssignment.findFirst({ where: { teacherId, classSectionId, subjectId, kind } });
    if (existing) return existing;
    return prisma.teachingAssignment.create({
      data: {
        teacherId,
        classSectionId,
        subjectId,
        kind,
        academicYearId: year.id,
        moduleId: kind === "MODULE_EXAM" ? mod1.id : null,
        validFrom: year.startDate,
        createdById: admin.id,
        ...(ended ? { endedAt: new Date(), endedById: admin.id, endReason: "Plecat din unitate", validTo: year.startDate } : {}),
      },
    });
  };
  const aPopescu112 = await assign(popescu.id, c112.id, mat.id, "SUBJECT_TEACHING");
  await assign(popescu.id, c111.id, mat.id, "SUBJECT_TEACHING");
  await assign(popescu.id, c112.id, mat.id, "MODULE_EXAM");
  const aIonescu113 = await assign(ionescu.id, c113.id, nav.id, "SUBJECT_TEACHING");
  await assign(ionescu.id, c113.id, practica.id, "PRACTICAL_TRAINING");
  const aGeorgescu112 = await assign(georgescu.id, c112.id, eng.id, "SUBJECT_TEACHING");
  await assign(inactiv.id, c113.id, mat.id, "SUBJECT_TEACHING", true);

  const homeroom = async (teacherId: string, classSectionId: string) => {
    const existing = await prisma.homeroomAssignment.findFirst({ where: { classSectionId, endedAt: null } });
    if (existing) return existing;
    return prisma.homeroomAssignment.create({
      data: { teacherId, classSectionId, academicYearId: year.id, validFrom: year.startDate, createdById: admin.id },
    });
  };
  await homeroom(ionescu.id, c112.id); // diriginte 112, teaches only in 113
  await homeroom(georgescu.id, c113.id);

  const reason = async (code: string) => (await prisma.gradeReason.findUniqueOrThrow({ where: { code } })).id;
  const grade = async (studentId: string, classSectionId: string, subjectId: string, authorId: string, value: number, reasonCode: string, kind: "CURRENT" | "FINAL", teachingAssignmentId: string | null) => {
    const enrollment = await prisma.enrollment.findFirstOrThrow({ where: { studentId, academicYearId: year.id } });
    const existing = await prisma.grade.findFirst({ where: { studentId, subjectId, authorId, value } });
    if (existing) return existing;
    const g = await prisma.grade.create({
      data: {
        studentId,
        enrollmentId: enrollment.id,
        classSectionId,
        subjectId,
        academicYearId: year.id,
        moduleId: classSectionId === c211.id ? mod2.id : mod1.id,
        kind,
        value,
        reasonId: await reason(reasonCode),
        gradeDate: year.startDate,
        authorId,
        teachingAssignmentId,
      },
    });
    await prisma.gradeRevision.create({
      data: { gradeId: g.id, revisionNo: 1, action: "CREATE", value, reasonId: g.reasonId, gradeDate: g.gradeDate, status: "ACTIVE", changedById: authorId },
    });
    return g;
  };
  const gMarinMat = await grade(sMarin.id, c112.id, mat.id, popescu.id, 9, "TESTARE", "CURRENT", aPopescu112.id);
  const gMarinEng = await grade(sMarin.id, c112.id, eng.id, georgescu.id, 8, "ASCULTARE", "CURRENT", aGeorgescu112.id);
  const gDobreNav = await grade(sDobre.id, c113.id, nav.id, ionescu.id, 10, "PROIECT", "CURRENT", aIonescu113.id);
  const gMarinPurtare = await grade(sMarin.id, c112.id, purtare.id, ionescu.id, 10, "NOTA_PURTARE", "FINAL", null);

  // Published timetable for the whole year.
  let version = await prisma.timetableVersion.findFirst({ where: { academicYearId: year.id, name: "Orar demonstrativ" } });
  if (!version) {
    version = await prisma.timetableVersion.create({
      data: {
        academicYearId: year.id,
        name: "Orar demonstrativ",
        validFrom: year.startDate,
        status: "PUBLISHED",
        createdById: admin.id,
        publishedById: admin.id,
        publishedAt: new Date(),
      },
    });
    const slot = async (index: number) => (await prisma.timeSlot.findUniqueOrThrow({ where: { index } })).id;
    const entries = [
      { classSectionId: c112.id, dayOfWeek: 1, index: 1, subjectId: mat.id, teacherId: popescu.id, room: "A12" },
      { classSectionId: c112.id, dayOfWeek: 1, index: 2, subjectId: eng.id, teacherId: georgescu.id, room: "A12" },
      { classSectionId: c113.id, dayOfWeek: 2, index: 1, subjectId: nav.id, teacherId: ionescu.id, room: "Sim-1" },
      { classSectionId: c113.id, dayOfWeek: 3, index: 3, subjectId: practica.id, teacherId: ionescu.id, room: "Atelier" },
      { classSectionId: c111.id, dayOfWeek: 3, index: 1, subjectId: mat.id, teacherId: popescu.id, room: "B03" },
    ];
    for (const e of entries) {
      await prisma.timetableEntry.create({
        data: {
          versionId: version.id,
          classSectionId: e.classSectionId,
          dayOfWeek: e.dayOfWeek,
          timeSlotId: await slot(e.index),
          subjectId: e.subjectId,
          teacherId: e.teacherId,
          room: e.room,
        },
      });
    }
  }

  return {
    yearId: year.id,
    users: { admin, comandant, popescu, ionescu, georgescu, inactiv, elevA, elevC },
    classes: { c111, c112, c113, c211 },
    subjects: { mat, eng, nav, practica, purtare },
    students: { sMarin, sStan, sDobre, sVasile, sPetre },
    grades: { gMarinMat, gMarinEng, gDobreNav, gMarinPurtare },
    modules: { mod1, mod2 },
  };
}
