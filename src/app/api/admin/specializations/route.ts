import { apiRoute, readJson } from "@/server/http/api";
import { createSpecialization, listSpecializations } from "@/server/domain/academic";
import { createSpecializationSchema } from "@/lib/validation/schemas";

export const GET = apiRoute({ permission: "structure.read" }, async ({ actor }) => ({
  specializations: await listSpecializations(actor),
}));

export const POST = apiRoute({ permission: "structure.manage" }, async ({ req, actor }) => ({
  specialization: await createSpecialization(actor, await readJson(req, createSpecializationSchema)),
}));
