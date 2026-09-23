import { z } from "zod";
import { isoDate, personName, reasonText, shortText, username, uuid } from "@/lib/validation/common";

const password = z.string({ error: "Parola este obligatorie." }).min(1, { error: "Parola este obligatorie." }).max(128);

export const loginSchema = z.object({
  username: z.string({ error: "Numele de utilizator este obligatoriu." }).max(64),
  password: z.string({ error: "Parola este obligatorie." }).max(128),
});

export const changePasswordSchema = z.strictObject({
  currentPassword: password,
  newPassword: password,
});

export const STAFF_ROLES = ["ADMINISTRATOR", "COMANDANT_UNITATE", "PROFESOR"] as const;

export const createUserSchema = z.strictObject({
  firstName: personName,
  lastName: personName,
  rankId: uuid.nullable().optional(),
  username,
  role: z.enum(["ADMINISTRATOR", "COMANDANT_UNITATE", "PROFESOR", "ELEV"], { error: "Rol invalid." }),
  temporaryPassword: password,
  /** Required for ELEV accounts (links the login to the academic record). */
  studentId: uuid.optional(),
});

export const updateUserSchema = z.strictObject({
  firstName: personName.optional(),
  lastName: personName.optional(),
  rankId: uuid.nullable().optional(),
  role: z.enum(STAFF_ROLES, { error: "Rol invalid." }).optional(),
});

export const setUserStatusSchema = z.strictObject({
  status: z.enum(["ACTIVE", "INACTIVE", "DELETED"], { error: "Stare invalidă." }),
  reason: reasonText,
});

export const resetPasswordSchema = z.strictObject({ temporaryPassword: password });

export const academicYearSchema = z
  .strictObject({
    name: z.string().trim().regex(/^\d{4}–\d{4}$|^\d{4}-\d{4}$/, { error: "Format: 2026–2027." }),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((v) => v.endDate > v.startDate, { error: "Data de sfârșit trebuie să fie după data de început.", path: ["endDate"] });

export const academicYearStatusSchema = z.strictObject({
  status: z.enum(["ACTIVE", "CLOSED"], { error: "Stare invalidă." }),
});

export const classSuffix = z.string().regex(/^[0-9]{2}$/, { error: "Sufixul clasei are 2 cifre (ex. 12)." });

export const createClassSchema = z.strictObject({
  academicYearId: uuid,
  yearOfStudy: z.union([z.literal(1), z.literal(2)], { error: "Anul de studiu este 1 sau 2." }),
  suffix: classSuffix,
  specializationId: uuid.nullable().optional(),
});

export const updateClassSchema = z.strictObject({
  active: z.boolean().optional(),
  specializationId: uuid.nullable().optional(),
});

export const createSpecializationSchema = z.strictObject({
  code: z.string().trim().regex(/^[A-Z0-9_-]{1,20}$/, { error: "Cod: litere mari, cifre, - sau _ (max. 20)." }),
  name: shortText(120),
});

export const createSubjectSchema = z.strictObject({
  code: z.string().trim().regex(/^[A-Z0-9_-]{1,20}$/, { error: "Cod: litere mari, cifre, - sau _ (max. 20)." }),
  name: shortText(120),
  shortName: z.string().trim().max(30).optional(),
  type: z.enum(["GENERAL", "SPECIALIZATION", "PRACTICAL_TRAINING"], { error: "Tip de materie invalid." }),
});

export const updateSubjectSchema = z.strictObject({
  name: shortText(120).optional(),
  shortName: z.string().trim().max(30).nullable().optional(),
  active: z.boolean().optional(),
});

export const createModuleSchema = z.strictObject({
  academicYearId: uuid,
  yearOfStudy: z.union([z.literal(1), z.literal(2)], { error: "Anul de studiu este 1 sau 2." }),
  name: shortText(80),
  order: z.number().int().min(1).max(20),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
});

export const updateModuleSchema = z.strictObject({
  name: shortText(80).optional(),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  status: z.enum(["OPEN", "CLOSED"]).optional(),
});

export const gradeKinds = z.enum(["CURRENT", "MODULE_EXAM", "FINAL"], { error: "Tip de notă invalid." });

export const gradeReasonSchema = z.strictObject({
  code: z.string().trim().regex(/^[A-Z0-9_]{1,30}$/, { error: "Cod: litere mari, cifre sau _ (max. 30)." }),
  label: shortText(80),
  appliesTo: z.array(gradeKinds).min(1, { error: "Selectați cel puțin un tip de notă." }),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});

export const updateGradeReasonSchema = z.strictObject({
  label: shortText(80).optional(),
  appliesTo: z.array(gradeKinds).min(1).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
});

export const createStudentSchema = z.strictObject({
  firstName: personName,
  lastName: personName,
  rankId: uuid.nullable().optional(),
  registryNumber: z.string().trim().max(30).optional(),
  classSectionId: uuid,
});

export const createTeachingAssignmentSchema = z.strictObject({
  teacherId: uuid,
  classSectionId: uuid,
  subjectId: uuid,
  kind: z.enum(["SUBJECT_TEACHING", "PRACTICAL_TRAINING", "MODULE_EXAM"]).default("SUBJECT_TEACHING"),
  moduleId: uuid.optional(),
  validFrom: isoDate.optional(),
  validTo: isoDate.optional(),
});

export const createHomeroomSchema = z.strictObject({
  teacherId: uuid,
  classSectionId: uuid,
  validFrom: isoDate.optional(),
});

export const endAssignmentSchema = z.strictObject({ reason: reasonText });

export const createGradeSchema = z.strictObject({
  studentId: uuid,
  classSectionId: uuid,
  subjectId: uuid,
  kind: gradeKinds.default("CURRENT"),
  value: z.number({ error: "Nota trebuie să fie un număr." }).min(1, { error: "Nota minimă este 1." }).max(10, { error: "Nota maximă este 10." }),
  reasonId: uuid,
  gradeDate: isoDate,
  moduleId: uuid.optional(),
  note: z.string().trim().max(300).optional(),
});

export const timetableQuerySchema = z.object({
  week: isoDate.optional(),
  classSectionId: uuid.optional(),
  teacherId: uuid.optional(),
});

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  action: z.string().regex(/^[A-Z_]{2,40}$/).optional(),
  actorId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
