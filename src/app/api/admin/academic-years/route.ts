import { apiRoute, readJson } from "@/server/http/api";
import { createAcademicYear, listAcademicYears } from "@/server/domain/academic";
import { academicYearSchema } from "@/lib/validation/schemas";

export const GET = apiRoute({ permission: "structure.read" }, async ({ actor }) => ({
  academicYears: await listAcademicYears(actor),
}));

export const POST = apiRoute({ permission: "structure.manage" }, async ({ req, actor }) => ({
  academicYear: await createAcademicYear(actor, await readJson(req, academicYearSchema)),
}));
