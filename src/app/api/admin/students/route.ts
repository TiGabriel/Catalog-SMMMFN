import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { createStudent, listStudentsAdmin } from "@/server/domain/students";
import { createStudentSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({ permission: "structure.read" }, async ({ req, actor }) => {
  const classId = req.nextUrl.searchParams.get("classSectionId");
  return { students: await listStudentsAdmin(actor, classId ? parseParam(uuid, classId) : undefined) };
});

export const POST = apiRoute({ permission: "students.manage" }, async ({ req, actor }) => ({
  student: await createStudent(actor, await readJson(req, createStudentSchema)),
}));
