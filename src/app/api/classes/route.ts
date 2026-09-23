import { apiRoute, parseParam } from "@/server/http/api";
import { listMyClasses } from "@/server/domain/catalog";
import { uuid } from "@/lib/validation/common";

export const GET = apiRoute({}, async ({ req, actor }) => {
  const y = req.nextUrl.searchParams.get("academicYearId");
  return { classes: await listMyClasses(actor, y ? parseParam(uuid, y) : undefined) };
});
