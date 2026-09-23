import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { addModuleSubject, listModuleSubjects } from "@/server/domain/curriculum";
import { moduleSubjectSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({ permission: "structure.read" }, async ({ actor, params }) => ({
  subjects: await listModuleSubjects(actor, parseParam(uuid, params.id)),
}));

export const POST = apiRoute({ permission: "structure.manage" }, async ({ req, actor, params }) => ({
  moduleSubject: await addModuleSubject(actor, parseParam(uuid, params.id), await readJson(req, moduleSubjectSchema)),
}));
