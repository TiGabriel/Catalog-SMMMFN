import { apiRoute, parseParam, readJson } from "@/server/http/api";
import { reviewCorrectionRequest } from "@/server/domain/corrections";
import { reviewCorrectionSchema } from "@/lib/validation/schemas";
import { uuid } from "@/lib/validation/common";

export const POST = apiRoute({ permission: "corrections.review" }, async ({ req, actor, params }) => {
  const id = parseParam(uuid, params.id);
  return { result: await reviewCorrectionRequest(actor, id, await readJson(req, reviewCorrectionSchema)) };
});
