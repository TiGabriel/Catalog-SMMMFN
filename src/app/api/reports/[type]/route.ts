import { apiRoute } from "@/server/http/api";
import { auditExport, buildReport } from "@/server/reports";
import { reportFileName, reportToXlsx } from "@/server/reports/xlsx";

/** GET /api/reports/{type}?…&format=xlsx|json – authorization is enforced inside each report builder. */
export const GET = apiRoute({}, async ({ req, actor, params }) => {
  const query = Object.fromEntries(req.nextUrl.searchParams);
  const format = query.format === "xlsx" ? "xlsx" : "json";
  delete query.format;
  const report = await buildReport(actor, params.type ?? "", query);
  await auditExport(actor, report.type, query, format);
  if (format === "json") return { report };
  const buf = await reportToXlsx(report);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${reportFileName(report)}"`,
    },
  });
});
