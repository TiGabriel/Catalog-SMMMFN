import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { createClass, listClasses } from "@/server/domain/academic";
import { createClassSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({ permission: "structure.read" }, async ({ req, actor }) => {
  const yearId = req.nextUrl.searchParams.get("academicYearId");
  return { classes: await listClasses(actor, yearId ? parseParam(uuid, yearId) : undefined) };
});

export const POST = apiRoute({ permission: "structure.manage" }, async ({ req, actor }) => ({
  class: await createClass(actor, await readJson(req, createClassSchema)),
}));
