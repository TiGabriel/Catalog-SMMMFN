import { apiRoute } from "@/server/http/api";
import { listGradeReasons } from "@/server/domain/curriculum";

export const GET = apiRoute({ permission: "grades.create.scoped" }, async ({ actor }) => ({
  gradeReasons: await listGradeReasons(actor),
}));
