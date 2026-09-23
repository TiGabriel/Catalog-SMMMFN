import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, GradePill, PageHeader, TableWrap } from "@/components/ui";
import { getPageContext, load } from "@/server/http/page";
import { getGradeWithHistory } from "@/server/domain/grades";
import { listGradeReasons } from "@/server/domain/curriculum";
import { findGradeGrant } from "@/server/authz/policy";
import {
  GRADE_KIND_LABEL, REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL, REVISION_ACTION_LABEL, formatDate, formatDateTime, isoToday, personName,
} from "@/lib/format";
import { GradeActions } from "@/components/catalog/grade-actions";

export const metadata: Metadata = { title: "Detalii notă" };

export default async function GradePage({ params }: { params: Promise<{ gradeId: string }> }) {
  const { gradeId } = await params;
  const { actor, caps } = await getPageContext();
  const data = await load(getGradeWithHistory(actor, gradeId));
  const g = data.grade;
  const hasGrant =
    caps.introducereNote &&
    !!(await findGradeGrant(actor, { classSectionId: g.classSection.id, subjectId: g.subject.id, subjectType: g.subject.type, kind: g.kind, moduleId: g.module?.id ?? null }));
  const reasons = caps.introducereNote ? (await listGradeReasons(actor)).filter((r) => r.appliesTo.includes(g.kind)) : [];
  const pending = data.correctionRequests.some((r) => r.status === "PENDING");

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: caps.catalogGeneral ? "Catalog" : "Clasele mele", href: "/catalog" },
          { label: `Clasa ${g.classSection.code}`, href: `/catalog/clase/${g.classSection.id}` },
          { label: g.subject.name, href: `/catalog/clase/${g.classSection.id}/materii/${g.subject.id}` },
          { label: "Notă" },
        ]}
        title={`${g.student.lastName} ${g.student.firstName} – ${g.subject.name}`}
        subtitle={`${GRADE_KIND_LABEL[g.kind]} · ${g.module?.name ?? "fără modul"} · Clasa ${g.classSection.code}`}
      />

      {g.status === "DELETED" && (
        <div className="mb-6">
          <Alert tone="warning" title="Notă ștearsă">
            Ștearsă la {formatDateTime(g.deletedAt)} de {personName(g.deletedBy)}. Motiv: {g.deletionReason}. Nota rămâne în istoric, dar nu mai este luată în calcul.
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center gap-4">
            <span className="scale-150 pl-2">
              <GradePill value={g.value} muted={g.status === "DELETED"} />
            </span>
            <div>
              <p className="text-sm text-muted">{g.reason?.label ?? "—"}</p>
              <p className="text-sm">Data: {formatDate(g.gradeDate)}</p>
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted">Autor</dt>
            <dd>{personName(g.author)}</dd>
            <dt className="text-muted">Înregistrată</dt>
            <dd>{formatDateTime(g.createdAt)}</dd>
            <dt className="text-muted">Ultima actualizare</dt>
            <dd>{formatDateTime(g.updatedAt)}</dd>
            <dt className="text-muted">Stare</dt>
            <dd>{g.status === "ACTIVE" ? <Badge tone="success">Activă</Badge> : <Badge tone="danger">Ștearsă</Badge>}</dd>
            {g.note && (
              <>
                <dt className="text-muted">Observații</dt>
                <dd>{g.note}</dd>
              </>
            )}
          </dl>
        </Card>

        <div className="lg:col-span-2">
          {g.status === "ACTIVE" && (data.permissions.canModify || hasGrant) && (
            <GradeActions
              grade={{ id: g.id, value: g.value, version: g.version, reasonId: g.reason?.id ?? null, gradeDate: new Date(g.gradeDate).toISOString().slice(0, 10), note: g.note }}
              canModify={data.permissions.canModify}
              canRequest={hasGrant && !pending}
              pendingRequest={pending}
              reasons={reasons.map((r) => ({ id: r.id, label: r.label }))}
              today={isoToday()}
            />
          )}
          {g.status === "ACTIVE" && !data.permissions.canModify && !hasGrant && (
            <Alert tone="primary">Aveți acces doar în citire la această notă.</Alert>
          )}
        </div>

        <Card className="lg:col-span-3">
          <CardHeader title="Istoricul notei" description="Fiecare stare a notei este păstrată; istoricul nu poate fi modificat." />
          <TableWrap>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nr.</th>
                  <th>Acțiune</th>
                  <th>Notă</th>
                  <th>Tip evaluare</th>
                  <th>Data notei</th>
                  <th>Efectuată de</th>
                  <th>Momentul</th>
                  <th>Motivul modificării</th>
                </tr>
              </thead>
              <tbody>
                {data.revisions.map((r) => (
                  <tr key={r.revisionNo}>
                    <td className="tabular">{r.revisionNo}</td>
                    <td>
                      <Badge tone={r.action === "DELETE" ? "danger" : r.action === "UPDATE" ? "warning" : "primary"}>{REVISION_ACTION_LABEL[r.action]}</Badge>
                      {r.correctionRequestId && <Badge tone="accent" className="ml-1">Cerere aprobată</Badge>}
                    </td>
                    <td><GradePill value={r.value} muted={r.action === "DELETE"} /></td>
                    <td>{r.reason?.label ?? "—"}</td>
                    <td className="tabular">{formatDate(r.gradeDate)}</td>
                    <td>{personName(r.changedBy)}</td>
                    <td className="tabular whitespace-nowrap">{formatDateTime(r.changedAt)}</td>
                    <td className="max-w-xs">{r.changeReason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        {data.correctionRequests.length > 0 && (
          <Card className="lg:col-span-3">
            <CardHeader title="Cereri de corecție" />
            <ul className="divide-y divide-border">
              {data.correctionRequests.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span>
                    {REQUEST_TYPE_LABEL[r.type]}
                    {r.proposedValue !== null && <> → <GradePill value={r.proposedValue} /></>} · {r.justification}
                  </span>
                  <span className="flex items-center gap-2 text-muted">
                    {formatDateTime(r.createdAt)}
                    <Badge tone={r.status === "APPROVED" ? "success" : r.status === "REJECTED" ? "danger" : r.status === "PENDING" ? "warning" : "neutral"}>
                      {REQUEST_STATUS_LABEL[r.status]}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
