import { apiRoute, readJson } from "@/server/http/api";
import { createRuleSet, listRuleSets } from "@/server/domain/results";
import { ruleSetCreateSchema } from "@/lib/validation/schemas";

export const GET = apiRoute({ permission: "config.read" }, async ({ actor }) => ({ ruleSets: await listRuleSets(actor) }));

export const POST = apiRoute({ permission: "config.manage" }, async ({ req, actor }) => ({
  ruleSet: await createRuleSet(actor, await readJson(req, ruleSetCreateSchema)),
}));
