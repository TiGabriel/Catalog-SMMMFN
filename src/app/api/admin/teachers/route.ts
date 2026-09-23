import { apiRoute } from "@/server/http/api";
import { listAssignableTeachers } from "@/server/domain/assignments";

export const GET = apiRoute({ permission: "assignments.manage" }, async ({ actor }) => ({
  teachers: await listAssignableTeachers(actor),
}));
