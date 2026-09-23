import { apiRoute } from "@/server/http/api";
import { getWeekTimetable } from "@/server/domain/timetable";
import { timetableQuerySchema } from "@/lib/validation/schemas";
import { Errors } from "@/server/errors";

export const GET = apiRoute({}, async ({ req, actor }) => {
  const parsed = timetableQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw Errors.notFound();
  return getWeekTimetable(actor, parsed.data);
});
