import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { getPageContext, load, requireCap } from "@/server/http/page";
import { ACADEMIC_AUDIT_ACTIONS, listAuditActors, listAuditEntries } from "@/server/domain/audit-read";
import { listAcademicYears, listClasses } from "@/server/domain/academic";
import { listSubjects } from "@/server/domain/curriculum";
import { listStudentsAdmin } from "@/server/domain/students";
import { auditQuerySchema } from "@/lib/validation/schemas";
import { AUDIT_ACTION_LABEL, formatDateTime, personName, plural } from "@/lib/format";
import { AuditFilters } from "@/components/audit/audit-filters";
import { VerifyChainButton } from "@/components/audit/verify-chain";

export const metadata: Metadata = { title: "Jurnal de audit" };

function describe(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return String(v);
  const o = v as Record<string, unknown>;
  const parts: string[] = [];
  if ("value" in o) parts.push(`nota ${o.value}`);
  if ("status" in o && o.status !== "ACTIVE") parts.push(String(o.status) === "DELETED" ? "ștearsă" : String(o.status));
  if ("gradeDate" in o) parts.push(`data ${String(o.gradeDate).split("-").reverse().join(".")}`);
  if ("proposedValue" in o && o.proposedValue !== null) parts.push(`propus ${o.proposedValue}`);
  return parts.length ? parts.join(", ") : null;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const { actor, caps } = await getPageContext();
  requireCap(caps.audit);
  const system = caps.administrare;
  const parsed = auditQuerySchema.safeParse(Object.fromEntries(Object.entries(sp).filter(([, v]) => v !== "")));
  const query = parsed.success ? parsed.data : auditQuerySchema.parse({});
  const [data, years, actors, subjects] = await Promise.all([
    load(listAuditEntries(actor, query)),
    listAcademicYears(actor),
    listAuditActors(actor),
    listSubjects(actor),
  ]);
  const year = years.find((y) => y.id === query.academicYearId) ?? years.find((y) => y.status === "ACTIVE");
  const classes = year ? await listClasses(actor, year.id) : [];
  const students = query.classSectionId ? await listStudentsAdmin(actor, query.classSectionId, true) : [];
  const actions = system ? Object.keys(AUDIT_ACTION_LABEL) : ACADEMIC_AUDIT_ACTIONS;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pageLink = (p: number) => `?${new URLSearchParams({ ...sp, page: String(p) }).toString()}`;

  return (
    <>
      <PageHeader
        title={system ? "Jurnal de audit" : "Audit note și corecturi"}
        subtitle={
          system
            ? "Auditul complet al sistemului. Înregistrările nu pot fi modificate sau șterse; integritatea este verificabilă criptografic."
            : "Introducerea, modificarea și ștergerea notelor, cererile de corecție și soluționarea lor, închiderea modulelor."
        }
        actions={<VerifyChainButton />}
      />
      <Card className="mb-4">
        <AuditFilters
          values={sp}
          actions={actions.map((a) => ({ value: a, label: AUDIT_ACTION_LABEL[a] ?? a }))}
          users={actors.map((u) => ({ value: u.id, label: personName(u) }))}
          years={years.map((y) => ({ value: y.id, label: y.name }))}
          classes={classes.map((c) => ({ value: c.id, label: c.code }))}
          subjects={subjects.map((s) => ({ value: s.id, label: s.name }))}
          students={students.map((s) => ({ value: s.id, label: `${s.lastName} ${s.firstName}` }))}
        />
      </Card>
      <Card>
        <CardHeader title={plural(data.total, "înregistrare", "înregistrări")} description={`Pagina ${data.page} din ${pages}`} actions={<ShieldCheck className="h-5 w-5 text-primary" />} />
        {data.entries.length === 0 ? (
          <EmptyState title="Nu există înregistrări pentru filtrele selectate." />
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Momentul</th>
                  <th>Acțiune</th>
                  <th>Utilizator</th>
                  <th>Elev / clasă / materie</th>
                  <th>Înainte</th>
                  <th>După</th>
                  <th>Motiv</th>
                  {system && <th>Tehnic</th>}
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="tabular whitespace-nowrap text-sm">{formatDateTime(e.occurredAt)}</td>
                    <td>
                      <Badge tone={e.outcome === "SUCCESS" ? (e.action.includes("DELETE") ? "danger" : "primary") : e.outcome === "DENIED" ? "danger" : "warning"}>
                        {AUDIT_ACTION_LABEL[e.action] ?? e.action}
                      </Badge>
                    </td>
                    <td className="text-sm">{e.actor?.name ?? <span className="text-muted">sistem</span>}</td>
                    <td className="text-sm">
                      {[e.student, e.classSection ? `clasa ${e.classSection}` : null, e.subject].filter(Boolean).join(" · ") || <span className="text-muted">—</span>}
                    </td>
                    <td className="text-sm">{describe(e.before) ?? <span className="text-muted">—</span>}</td>
                    <td className="text-sm">{describe(e.after) ?? <span className="text-muted">—</span>}</td>
                    <td className="max-w-xs text-sm">{e.reason ?? <span className="text-muted">—</span>}</td>
                    {system && (
                      <td className="max-w-56 text-xs text-muted" title={e.userAgent ?? ""}>
                        {e.ip ?? "—"}
                        {e.metadata ? <details><summary className="cursor-pointer">detalii</summary><pre className="whitespace-pre-wrap break-all font-sans">{JSON.stringify(e.metadata, null, 1)}</pre></details> : null}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm">
            {data.page > 1 ? <Link href={pageLink(data.page - 1)} className="text-primary hover:underline">← Mai noi</Link> : <span />}
            {data.page < pages ? <Link href={pageLink(data.page + 1)} className="text-primary hover:underline">Mai vechi →</Link> : <span />}
          </div>
        )}
      </Card>
    </>
  );
}
