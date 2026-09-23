import { apiRoute, parseParam } from "@/server/http/api";
import { cancelCorrectionRequest } from "@/server/domain/corrections";
import { uuid } from "@/lib/validation/common";

export const POST = apiRoute({ permission: "corrections.request" }, async ({ actor, params }) => ({
  result: await cancelCorrectionRequest(actor, parseParam(uuid, params.id)),
}));
