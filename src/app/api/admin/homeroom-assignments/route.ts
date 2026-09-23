import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { createHomeroomAssignment, listHomeroomAssignments } from "@/server/domain/assignments";
import { createHomeroomSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({ permission: "structure.read" }, async ({ req, actor }) => {
  const sp = req.nextUrl.searchParams;
  return {
    assignments: await listHomeroomAssignments(actor, {
      academicYearId: sp.get("academicYearId") ? parseParam(uuid, sp.get("academicYearId")) : undefined,
      includeEnded: sp.get("includeEnded") === "true",
    }),
  };
});

export const POST = apiRoute({ permission: "assignments.manage" }, async ({ req, actor }) => ({
  assignment: await createHomeroomAssignment(actor, await readJson(req, createHomeroomSchema)),
}));
