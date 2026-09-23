import { apiRoute } from "@/server/http/api";
import { getOwnGrades } from "@/server/domain/catalog";

export const GET = apiRoute({ permission: "self.academic.read" }, async ({ actor }) => getOwnGrades(actor));
