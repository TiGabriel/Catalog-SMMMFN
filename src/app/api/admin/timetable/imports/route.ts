import { z } from "zod";
import { apiRoute } from "@/server/http/api";
import { importTimetable, listTimetableImports } from "@/server/domain/timetable-admin";
import { MAX_UPLOAD_BYTES } from "@/server/timetable/xlsx-safety";
import { isoDate, shortText, uuid } from "@/lib/validation/common";
import { Errors } from "@/server/errors";
import { zodDetails } from "@/server/http/api";

const fieldsSchema = z.strictObject({
  academicYearId: uuid,
  validFrom: isoDate,
  validTo: isoDate.optional(),
  name: shortText(80),
});

export const GET = apiRoute({ permission: "timetable.manage" }, async ({ actor }) => ({ imports: await listTimetableImports(actor) }));

/** multipart/form-data: file (.xlsx ≤ 2 MB) + academicYearId + validFrom (+ validTo) + name. */
export const POST = apiRoute({ permission: "timetable.manage", multipart: true }, async ({ req, actor }) => {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (!len || len > MAX_UPLOAD_BYTES + 64 * 1024) throw Errors.validation({ file: ["Fișierul lipsește sau depășește 2 MB."] });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw Errors.validation(undefined, "Cererea nu a putut fi citită.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw Errors.validation({ file: ["Selectați fișierul Excel."] });
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw Errors.validation({ file: ["Sunt acceptate doar fișiere .xlsx."] });
  if (file.size > MAX_UPLOAD_BYTES) throw Errors.validation({ file: ["Fișierul depășește 2 MB."] });
  const raw: Record<string, string> = {};
  for (const k of ["academicYearId", "validFrom", "validTo", "name"]) {
    const v = form.get(k);
    if (typeof v === "string" && v !== "") raw[k] = v;
  }
  const fields = fieldsSchema.safeParse(raw);
  if (!fields.success) throw Errors.validation(zodDetails(fields.error));
  return importTimetable(actor, { file: Buffer.from(await file.arrayBuffer()), fileName: file.name, ...fields.data });
});
