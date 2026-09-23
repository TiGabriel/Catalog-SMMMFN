import type { Metadata } from "next";
import { Badge, Card, CardHeader, PageHeader, TableWrap } from "@/components/ui";
import { ActionButton, ApiForm } from "@/components/admin/api-form";
import { SettingEditor } from "@/components/admin/setting-editor";
import { RuleSetEditor } from "@/components/admin/ruleset-editor";
import { getPageActor, load } from "@/server/http/page";
import { listSettings } from "@/server/domain/settings";
import { listGradeReasons } from "@/server/domain/curriculum";
import { listRuleSets } from "@/server/domain/results";
import { listTimeSlotsForGrid } from "@/server/domain/timetable";
import { PROVISIONAL_RULES } from "@/server/results/rules";
import { GRADE_KIND_LABEL, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Configurare" };

export default async function ConfigPage() {
  const actor = await getPageActor();
  const [settings, reasons, ruleSets, slots] = await Promise.all([
    load(listSettings(actor)),
    load(listGradeReasons(actor, true)),
    load(listRuleSets(actor)),
    listTimeSlotsForGrid(),
  ]);
  const activeRules = ruleSets.find((r) => r.status === "ACTIVE" && !r.academicYearId);

  return (
    <>
      <PageHeader title="Configurare" subtitle="Toate modificările sunt înregistrate în jurnalul de audit. Parametrii de securitate (parole, sesiuni) sunt fixați în cod." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Setări" />
          <ul className="divide-y divide-border">
            {settings.map((s) => (
              <li key={s.key} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">{s.description}</p>
                  <p className="text-xs text-muted">{s.key}{s.isDefault ? " · valoare implicită" : ""}</p>
                </div>
                <SettingEditor settingKey={s.key} value={s.value as never} />
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Tipuri / motive de notă" description="Lista este configurabilă; motivele dezactivate rămân pe notele existente." />
          <TableWrap>
            <table className="data-table">
              <thead><tr><th>Denumire</th><th>Se aplică la</th><th>Stare</th><th /></tr></thead>
              <tbody>
                {reasons.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.label}</td>
                    <td className="text-sm">{r.appliesTo.map((k) => GRADE_KIND_LABEL[k]).join(", ")}</td>
                    <td>{r.active ? <Badge tone="success">Activ</Badge> : <Badge>Inactiv</Badge>}</td>
                    <td className="text-right">
                      <ActionButton method="PATCH" action={`/api/admin/grade-reasons/${r.id}`} body={{ active: !r.active }} label={r.active ? "Dezactivează" : "Activează"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <ApiForm
            action="/api/admin/grade-reasons"
            submitLabel="Adaugă motiv"
            successMessage="Motivul a fost adăugat."
            columns={3}
            extra={{ appliesTo: ["CURRENT"] }}
            fields={[
              { name: "code", label: "Cod", type: "text", required: true, placeholder: "ex. REFERAT" },
              { name: "label", label: "Denumire", type: "text", required: true, placeholder: "ex. Referat" },
            ]}
          />
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Reguli de calcul al mediilor"
            description="Seturile de reguli sunt versionate; o versiune activată nu mai poate fi modificată. Modulele închise păstrează rezultatele calculate cu regulile de la momentul închiderii."
          />
          <TableWrap>
            <table className="data-table">
              <thead><tr><th>Denumire</th><th>Versiune</th><th>Domeniu</th><th>Stare</th><th>Activat</th><th /></tr></thead>
              <tbody>
                {ruleSets.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.name}</td>
                    <td className="tabular">v{r.version}</td>
                    <td>{r.academicYear?.name ?? "Toți anii"}</td>
                    <td><Badge tone={r.status === "ACTIVE" ? "success" : r.status === "DRAFT" ? "warning" : "neutral"}>{r.status === "ACTIVE" ? "Activ" : r.status === "DRAFT" ? "În lucru" : "Arhivat"}</Badge></td>
                    <td className="text-sm text-muted">{formatDateTime(r.activatedAt)}</td>
                    <td className="text-right">
                      {r.status === "DRAFT" && <ActionButton action={`/api/admin/rule-sets/${r.id}/activate`} label="Activează" variant="primary" confirmText="Activați acest set de reguli? Setul activ anterior va fi arhivat." />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <RuleSetEditor initial={JSON.stringify(activeRules?.definition ?? PROVISIONAL_RULES, null, 2)} />
        </Card>

        <Card>
          <CardHeader title="Programul orelor" description="Intervalele orare folosite de orar (valori provizorii, de confirmat)." />
          <ul className="divide-y divide-border">
            {slots.map((s) => (
              <li key={s.id} className="flex justify-between px-5 py-2 text-sm">
                <span>Ora {s.index}</span>
                <span className="tabular text-muted">{s.startTime}–{s.endTime}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
