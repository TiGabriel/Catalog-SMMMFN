import { apiRoute, readJson } from "@/server/http/api";
import { createGradeReason, listGradeReasons } from "@/server/domain/curriculum";
import { gradeReasonSchema } from "@/lib/validation/schemas";

export const GET = apiRoute({ permission: "config.read" }, async ({ actor }) => ({
  gradeReasons: await listGradeReasons(actor, true),
}));

export const POST = apiRoute({ permission: "config.manage" }, async ({ req, actor }) => ({
  gradeReason: await createGradeReason(actor, await readJson(req, gradeReasonSchema)),
}));
