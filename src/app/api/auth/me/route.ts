import { apiRoute } from "@/server/http/api";
import { getProfile } from "@/server/domain/profile";

export const GET = apiRoute({ allowPendingPasswordChange: true }, async ({ actor }) => getProfile(actor));
