import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { endTeachingAssignment } from "@/server/domain/assignments";
import { endAssignmentSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const POST = apiRoute({ permission: "assignments.manage" }, async ({ req, actor, params }) => {
  const id = parseParam(uuid, params.id);
  const body = await readJson(req, endAssignmentSchema);
  return { assignment: await endTeachingAssignment(actor, id, body.reason) };
});
