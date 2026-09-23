import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { ActionButton, ApiForm } from "@/components/admin/api-form";
import { getPageActor, load } from "@/server/http/page";
import { listAcademicYears } from "@/server/domain/academic";
import { listRollovers, previewRollover } from "@/server/domain/rollover";
import { getSetting } from "@/server/domain/settings";
import { YEAR_STATUS_LABEL, formatDate, formatDateTime, plural } from "@/lib/format";

export const metadata: Metadata = { title: "Ani școlari" };

export default async function AcademicYearsPage() {
  const actor = await getPageActor();
  const [years, rollovers, mode] = await Promise.all([load(listAcademicYears(actor)), load(listRollovers(actor)), getSetting("rollover.mode")]);
  const plan = years.some((y) => y.status === "ACTIVE") ? await load(previewRollover(actor)) : null;

  return (
    <>
      <PageHeader title="Ani școlari" subtitle="Anii școlari se păstrează integral; anii încheiați sunt disponibili doar pentru consultare." />

      {plan && (
        <Card className="mb-6">
          <CardHeader
            title={`Trecerea în anul școlar ${plan.toYear.name}`}
            description={`Programată pentru ${formatDate(plan.toYear.startDate)} · mod: ${mode === "AUTO" ? "automat (serverul o execută la 1 septembrie)" : "cu confirmarea administratorului"}`}
            actions={
              plan.due && !plan.alreadyExecuted ? (
                <ActionButton
                  action="/api/admin/rollover/execute"
                  body={{ confirm: true }}
                  label="Execută trecerea acum"
                  variant="primary"
                  confirmText={`Confirmați trecerea în anul școlar ${plan.toYear.name}? Anul ${plan.fromYear.name} va fi închis.`}
                />
              ) : (
                <Badge tone={plan.alreadyExecuted ? "success" : "neutral"}>{plan.alreadyExecuted ? "Efectuată" : "Nu este încă scadentă"}</Badge>
              )
            }
          />
          <div className="grid gap-6 p-5 lg:grid-cols-3">
            <div>
              <p className="mb-2 text-sm font-semibold">Promovare (anul I → anul II)</p>
              <ul className="flex flex-col gap-1 text-sm">
                {plan.promotions.map((p) => (
                  <li key={p.fromClass} className="flex items-center gap-2">
                    <span className="tabular w-10 font-medium">{p.fromClass}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted" />
                    <span className="tabular w-10 font-medium">{p.toClass}</span>
                    <span className="text-muted">{plural(p.students, "elev", "elevi")}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">Absolvenți (anul II)</p>
              <ul className="flex flex-col gap-1 text-sm">
                {plan.graduations.map((g) => (
                  <li key={g.classCode}>
                    <span className="tabular font-medium">{g.classCode}</span> <span className="text-muted">– {plural(g.students, "elev", "elevi")}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-3 text-sm">
              <p>
                Clase noi de anul I: <span className="font-medium">{plan.newYearOneClasses.join(", ")}</span>
              </p>
              <p className="text-muted">
                Istoricul (note, module, purtare, practică, examene, profesori, audit) rămâne legat de anul {plan.fromYear.name}. Repartizările anului vechi se încheie; cele noi se configurează pentru noul an.
              </p>
              {plan.warnings.map((w, i) => (
                <Alert key={i} tone="warning">{w}</Alert>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Ani școlari" />
          <TableWrap>
            <table className="data-table">
              <thead><tr><th>An școlar</th><th>Perioadă</th><th>Stare</th><th /></tr></thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.id}>
                    <td className="font-medium">{y.name}</td>
                    <td className="tabular text-muted">{formatDate(y.startDate)} – {formatDate(y.endDate)}</td>
                    <td><Badge tone={y.status === "ACTIVE" ? "success" : y.status === "PLANNED" ? "warning" : "neutral"}>{YEAR_STATUS_LABEL[y.status]}</Badge></td>
                    <td className="text-right">
                      <div className="flex justify-end gap-3 text-sm">
                        <Link href={`/administrare/clase?an=${y.id}`} className="text-primary hover:underline">Clase</Link>
                        <Link href={`/administrare/elevi?an=${y.id}`} className="text-primary hover:underline">Elevi</Link>
                        <Link href={`/administrare/module?an=${y.id}`} className="text-primary hover:underline">Module</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
        <Card>
          <CardHeader title="Adaugă an școlar" description="De regulă, anul următor este creat automat la trecere." />
          <ApiForm
            action="/api/admin/academic-years"
            submitLabel="Adaugă"
            successMessage="Anul școlar a fost adăugat (planificat)."
            columns={2}
            fields={[
              { name: "name", label: "Denumire", type: "text", required: true, placeholder: "2027–2028", span: 2 },
              { name: "startDate", label: "Început", type: "date", required: true },
              { name: "endDate", label: "Sfârșit", type: "date", required: true },
            ]}
          />
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Istoricul trecerilor" />
        {rollovers.length === 0 ? (
          <EmptyState title="Nu a fost efectuată încă nicio trecere." />
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead><tr><th>Din</th><th>În</th><th>Executată</th><th>De</th><th>Promovați</th><th>Absolvenți</th></tr></thead>
              <tbody>
                {rollovers.map((r) => {
                  const s = r.summary as { promoted?: number; graduated?: number; trigger?: string };
                  return (
                    <tr key={r.id}>
                      <td>{r.fromYear.name}</td>
                      <td>{r.toYear.name}</td>
                      <td>{formatDateTime(r.executedAt)}</td>
                      <td>{r.executedBy ? `${r.executedBy.lastName} ${r.executedBy.firstName}` : s.trigger === "CLI" ? "Server (linie de comandă)" : "Server (automat)"}</td>
                      <td className="tabular">{s.promoted ?? "—"}</td>
                      <td className="tabular">{s.graduated ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
