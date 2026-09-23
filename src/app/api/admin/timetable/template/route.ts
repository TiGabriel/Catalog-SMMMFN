import { apiRoute, parseParam } from "@/server/http/api";
import { downloadTemplate } from "@/server/domain/timetable-admin";
import { getActiveAcademicYear } from "@/server/domain/academic";
import { uuid } from "@/lib/validation/common";
import { Errors } from "@/server/errors";

export const GET = apiRoute({ permission: "timetable.manage" }, async ({ req, actor }) => {
  const q = req.nextUrl.searchParams.get("academicYearId");
  const yearId = q ? parseParam(uuid, q) : (await getActiveAcademicYear())?.id;
  if (!yearId) throw Errors.notFound();
  const { buffer, fileName } = await downloadTemplate(actor, yearId);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
});
