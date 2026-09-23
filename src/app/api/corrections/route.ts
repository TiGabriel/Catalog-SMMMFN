import { apiRoute, readJson } from "@/server/http/api";
import { createCorrectionRequest, listCorrectionRequests } from "@/server/domain/corrections";
import { correctionQuerySchema, createCorrectionSchema } from "@/lib/validation/schemas";
import { Errors } from "@/server/errors";

export const GET = apiRoute({}, async ({ req, actor }) => {
  const q = correctionQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!q.success) throw Errors.validation();
  return { requests: await listCorrectionRequests(actor, q.data) };
});

export const POST = apiRoute({ permission: "corrections.request" }, async ({ req, actor }) => ({
  request: await createCorrectionRequest(actor, await readJson(req, createCorrectionSchema)),
}));
