import { apiRoute, readJson } from "@/server/http/api";
import { createSubject, listSubjects } from "@/server/domain/curriculum";
import { createSubjectSchema } from "@/lib/validation/schemas";

export const GET = apiRoute({ permission: "structure.read" }, async ({ actor }) => ({ subjects: await listSubjects(actor) }));

export const POST = apiRoute({ permission: "structure.manage" }, async ({ req, actor }) => ({
  subject: await createSubject(actor, await readJson(req, createSubjectSchema)),
}));
