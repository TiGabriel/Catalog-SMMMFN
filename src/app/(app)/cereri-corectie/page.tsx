import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, GradePill, PageHeader, TableWrap } from "@/components/ui";
import { getPageContext, load, requireCap } from "@/server/http/page";
import { listCorrectionRequests } from "@/server/domain/corrections";
import { REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL, formatDateTime, personName } from "@/lib/format";
import { CorrectionDecision } from "@/components/catalog/correction-decision";

export const metadata: Metadata = { title: "Cereri de corecție" };

const FILTERS = [
  ["PENDING", "În așteptare"],
  ["APPROVED", "Aprobate"],
  ["REJECTED", "Respinse"],
  ["CANCELLED", "Anulate"],
  ["", "Toate"],
] as const;

export default async function CorrectionsPage({ searchParams }: { searchParams: Promise<{ stare?: string }> }) {
  const sp = await searchParams;
  const { actor, caps } = await getPageContext();
  requireCap(caps.cereriCorectie);
  const status = FILTERS.some(([v]) => v === sp.stare) ? sp.stare : sp.stare === undefined ? "PENDING" : "";
  const requests = await load(listCorrectionRequests(actor, { status: (status || undefined) as never }));

  return (
    <>
      <PageHeader
        title="Cereri de corecție"
        subtitle={
          caps.aprobaCorecturi
            ? "Cereri speciale de corectare sau ștergere a notelor, trimise de profesori. Aprobarea aplică exact valoarea propusă."
            : "Cererile trimise de dumneavoastră și stadiul lor"
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([v, label]) => (
          <Link
            key={v}
            href={`?stare=${v}`}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${status === v ? "border-primary bg-primary text-primary-contrast" : "border-border hover:bg-surface-2"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <Card>
        <CardHeader title={`${requests.length} cereri`} />
        {requests.length === 0 ? (
          <EmptyState title="Nu există cereri pentru filtrul selectat." />
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Trimisă</th>
                  <th>Tip</th>
                  <th>Elev / clasă / materie</th>
                  <th>Nota actuală</th>
                  <th>Propunere</th>
                  <th>Justificare</th>
                  {caps.aprobaCorecturi && <th>Solicitant</th>}
                  <th>Stare</th>
                  <th className="no-print" />
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td className="tabular whitespace-nowrap text-muted">{formatDateTime(r.createdAt)}</td>
                    <td>{REQUEST_TYPE_LABEL[r.type]}</td>
                    <td>
                      <p className="font-medium">{r.student.lastName} {r.student.firstName}</p>
                      <p className="text-xs text-muted">
                        Clasa {r.classSection.code} · {r.subject.name}
                        {r.module ? ` · ${r.module.name}` : ""}
                      </p>
                    </td>
                    <td>
                      {r.grade ? (
                        <Link href={`/catalog/note/${r.grade.id}`}>
                          <GradePill value={r.grade.value} muted={r.grade.status === "DELETED"} />
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{r.type === "DELETE" ? <Badge tone="danger">Ștergere</Badge> : <GradePill value={r.proposedValue} />}</td>
                    <td className="max-w-xs text-sm">{r.justification}</td>
                    {caps.aprobaCorecturi && <td className="text-sm">{personName(r.requestedBy)}</td>}
                    <td>
                      <Badge tone={r.status === "APPROVED" ? "success" : r.status === "REJECTED" ? "danger" : r.status === "PENDING" ? "warning" : "neutral"}>
                        {REQUEST_STATUS_LABEL[r.status]}
                      </Badge>
                      {r.reviewedBy && (
                        <p className="mt-1 text-xs text-muted">
                          {personName(r.reviewedBy)}, {formatDateTime(r.reviewedAt)}
                          {r.reviewComment ? ` – ${r.reviewComment}` : ""}
                        </p>
                      )}
                    </td>
                    <td className="no-print">
                      {r.status === "PENDING" && <CorrectionDecision id={r.id} mode={caps.aprobaCorecturi ? "review" : "cancel"} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
