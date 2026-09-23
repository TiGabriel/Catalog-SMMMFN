import { apiRoute } from "@/server/http/api";
import { listCompanies } from "@/server/domain/academic";

export const GET = apiRoute({ permission: "structure.read" }, async ({ actor }) => ({ companies: await listCompanies(actor) }));
