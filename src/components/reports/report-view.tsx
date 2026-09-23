import { Alert, Card, CardHeader, GradePill, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { Report } from "@/server/reports/types";

/** Screen + print rendering of a report (the print layout omits navigation and buttons). */
export function ReportView({ report }: { report: Report }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="print-only">
        <p className="text-xs">Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”</p>
        <p className="text-lg font-bold">{report.title}</p>
        {report.subtitle && <p className="text-sm">{report.subtitle}</p>}
        <p className="text-xs">Generat la {formatDateTime(report.generatedAt)} de {report.generatedBy}</p>
      </div>
      {report.provisional && (
        <div className="no-print">
          <Alert tone="warning">Unele valori sunt calculate după reguli provizorii sau pentru module încă deschise.</Alert>
        </div>
      )}
      {report.sections.map((s, i) => (
        <Card key={i} className="print-plain break-inside-avoid-page">
          {s.title && <CardHeader title={s.title} className="print:border-none print:px-0" />}
          <TableWrap>
            <table className="data-table">
              <thead>
                <tr>
                  {s.columns.map((c, j) => (
                    <th key={j} className={c.numeric ? "text-center" : undefined}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((v, j) => {
                      const col = s.columns[j];
                      const isGrade = col?.numeric && typeof v === "number" && col.label !== "Nr." && !/Elevi|Note înregistrate/.test(col.label);
                      return (
                        <td key={j} className={col?.numeric ? "tabular text-center" : j === 1 ? "font-medium" : undefined}>
                          {v === null || v === "" ? <span className="text-muted">—</span> : isGrade ? <GradePill value={v as number} /> : v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {s.note && <p className="px-5 py-3 text-xs text-muted">{s.note}</p>}
        </Card>
      ))}
      {report.notes?.map((n, i) => (
        <p key={i} className="text-xs text-muted">{n}</p>
      ))}
    </div>
  );
}
