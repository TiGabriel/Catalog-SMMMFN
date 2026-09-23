import { z } from "zod";
import { apiRoute, readJson } from "@/server/http/api";
import { updateSetting } from "@/server/domain/settings";

const bodySchema = z.strictObject({ value: z.unknown() });

export const PUT = apiRoute({ permission: "config.manage" }, async ({ req, actor, params }) => {
  const body = await readJson(req, bodySchema);
  return { setting: await updateSetting(actor, params.key ?? "", body.value) };
});
