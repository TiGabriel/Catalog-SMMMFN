import { apiRoute } from "@/server/http/api";
import { listOwnGrades } from "@/server/domain/grades";

export const GET = apiRoute({ permission: "grades.create.scoped" }, async ({ req, actor }) => ({
  grades: await listOwnGrades(actor, { includeDeleted: req.nextUrl.searchParams.get("includeDeleted") === "true" }),
}));
