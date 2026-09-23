import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { getSubjectOverview, updateSubject } from "@/server/domain/curriculum";
import { updateSubjectSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const PATCH = apiRoute({ permission: "structure.manage" }, async ({ req, actor, params }) => {
  const id = parseParam(uuid, params.id);
  return { subject: await updateSubject(actor, id, await readJson(req, updateSubjectSchema)) };
});

export const GET = apiRoute({ permission: "structure.read" }, async ({ req, actor, params }) => {
  const yearId = req.nextUrl.searchParams.get("academicYearId");
  return getSubjectOverview(actor, parseParam(uuid, params.id), yearId ? parseParam(uuid, yearId) : undefined);
});
