import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { createModule, listModules } from "@/server/domain/curriculum";
import { createModuleSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({ permission: "structure.read" }, async ({ req, actor }) => {
  const yearId = req.nextUrl.searchParams.get("academicYearId");
  return { modules: await listModules(actor, yearId ? parseParam(uuid, yearId) : undefined) };
});

export const POST = apiRoute({ permission: "structure.manage" }, async ({ req, actor }) => ({
  module: await createModule(actor, await readJson(req, createModuleSchema)),
}));
