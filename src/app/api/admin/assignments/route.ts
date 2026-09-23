import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { createTeachingAssignment, listTeachingAssignments } from "@/server/domain/assignments";
import { createTeachingAssignmentSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({ permission: "structure.read" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  const opt = (k: string) => (sp.get(k) ? parseParam(uuid, sp.get(k)) : undefined);
  return {
    assignments: await listTeachingAssignments(actor, {
      academicYearId: opt("academicYearId"),
      teacherId: opt("teacherId"),
      classSectionId: opt("classSectionId"),
      includeEnded: sp.get("includeEnded") === "true",
    }),
  };
});

export const POST = apiRoute({ permission: "assignments.manage" }, async ({ req, actor }) => ({
  assignment: await createTeachingAssignment(actor, await readJson(req, createTeachingAssignmentSchema)),
}));
