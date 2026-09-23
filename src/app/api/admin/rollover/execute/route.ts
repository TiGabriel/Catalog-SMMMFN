import { z } from "zod";
import { apiRoute, readJson } from "@/server/http/api";
import { executeRollover } from "@/server/domain/rollover";

const schema = z.strictObject({ confirm: z.literal(true, { error: "Confirmați operațiunea." }) });

/** Manual execution by the administrator (only once the new year's start date is reached; idempotent). */
export const POST = apiRoute({ permission: "structure.manage" }, async ({ req, actor }) => {
  await readJson(req, schema);
  return { result: await executeRollover({ actor, trigger: "ADMIN" }) };
});
