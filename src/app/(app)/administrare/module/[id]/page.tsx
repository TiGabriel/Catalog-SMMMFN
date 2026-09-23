import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { ActionButton, ApiForm } from "@/components/admin/api-form";
import { getPageActor, load } from "@/server/http/page";
import { getModuleAdmin, listModuleSubjects, listSubjects } from "@/server/domain/curriculum";
import { MODULE_STATUS_LABEL, SUBJECT_TYPE_LABEL } from "@/lib/format";

export const metadata: Metadata = { title: "Plan modul" };

export default async function ModulePlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getPageActor();
  const m = await load(getModuleAdmin(actor, id));
  const [plan, subjects] = await Promise.all([load(listModuleSubjects(actor, id)), load(listSubjects(actor))]);
  const available = subjects.filter((s) => s.active && s.type !== "CONDUCT" && !plan.some((p) => p.subjectId === s.id));
  const editable = m.status !== "CLOSED";

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Module", href: "/administrare/module" }, { label: m.name }]}
        title={`${m.name} – anul ${m.yearOfStudy === 1 ? "I" : "II"}`}
        subtitle={`An școlar ${m.academicYear.name} · planul de materii al modulului · stare: ${MODULE_STATUS_LABEL[m.status]}`}
      />
      {editable && available.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Adaugă materie în modul" description="Purtarea face parte automat din fiecare modul." />
          <ApiForm
            action={`/api/admin/modules/${id}/subjects`}
            submitLabel="Adaugă"
            successMessage="Materia a fost adăugată în modul."
            columns={4}
            fields={[
              { name: "subjectId", label: "Materie", type: "select", required: true, options: available.map((s) => ({ value: s.id, label: `${s.name} (${SUBJECT_TYPE_LABEL[s.type]})` })) },
              { name: "weight", label: "Pondere (opțional)", type: "number", min: 0, max: 100, hint: "Folosită de regulile de calcul configurabile" },
              { name: "hoursPerWeek", label: "Ore/săptămână", type: "number", min: 0, max: 60 },
              { name: "hasFinalExam", label: "Are examen final de modul", type: "checkbox" },
            ]}
          />
        </Card>
      )}
      <Card>
        <CardHeader title={`${plan.length} materii în modul`} />
        {plan.length === 0 ? (
          <EmptyState title="Modulul nu are încă materii." />
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Materie</th>
                  <th>Tip</th>
                  <th>Examen final</th>
                  <th className="text-right">Pondere</th>
                  <th className="text-right">Ore/săpt.</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plan.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.subject.name}</td>
                    <td>{SUBJECT_TYPE_LABEL[p.subject.type]}</td>
                    <td>{p.hasFinalExam ? <Badge tone="accent">Da</Badge> : <span className="text-muted">Nu</span>}</td>
                    <td className="tabular text-right">{p.weight ?? "—"}</td>
                    <td className="tabular text-right">{p.hoursPerWeek ?? "—"}</td>
                    <td className="text-right">
                      {editable && (
                        <div className="flex justify-end gap-2">
                          <ActionButton method="PATCH" action={`/api/admin/module-subjects/${p.id}`} body={{ hasFinalExam: !p.hasFinalExam }} label={p.hasFinalExam ? "Fără examen" : "Cu examen"} />
                          <ActionButton method="DELETE" action={`/api/admin/module-subjects/${p.id}`} label="Elimină" variant="ghost" confirmText="Eliminați materia din modul? (Nu este posibil dacă există deja note.)" />
                        </div>
                      )}
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
