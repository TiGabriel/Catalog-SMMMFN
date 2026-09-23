import { apiRoute, readJson } from "@/server/http/api";
import { createGrade } from "@/server/domain/grades";
import { createGradeSchema } from "@/lib/validation/schemas";

// Role gate first (administrator/commander/student → 403), then scope checks inside the service.
export const POST = apiRoute({ permission: "grades.create.scoped" }, async ({ req, actor }) => ({
  grade: await createGrade(actor, await readJson(req, createGradeSchema)),
}));
