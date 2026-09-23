import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { getStudentAdmin, updateStudent } from "@/server/domain/students";
import { updateStudentSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({ permission: "structure.read" }, async ({ actor, params }) => ({
  student: await getStudentAdmin(actor, parseParam(uuid, params.id)),
}));

export const PATCH = apiRoute({ permission: "students.manage" }, async ({ req, actor, params }) => ({
  student: await updateStudent(actor, parseParam(uuid, params.id), await readJson(req, updateStudentSchema)),
}));
