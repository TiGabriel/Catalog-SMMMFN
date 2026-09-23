import { apiRoute, parseParam } from "@/server/http/api";
import { activateRuleSet } from "@/server/domain/results";
import { uuid } from "@/lib/validation/common";

export const POST = apiRoute({ permission: "config.manage" }, async ({ actor, params }) => ({
  ruleSet: await activateRuleSet(actor, parseParam(uuid, params.id)),
}));
