import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { ActionButton, ApiForm } from "@/components/admin/api-form";
import { getPageActor, load } from "@/server/http/page";
import { listAssignableTeachers, listHomeroomAssignments, listTeachingAssignments } from "@/server/domain/assignments";
import { getActiveAcademicYear, listClasses } from "@/server/domain/academic";
import { listModules, listSubjects } from "@/server/domain/curriculum";
import { ASSIGNMENT_KIND_LABEL, formatDate, personName } from "@/lib/format";

export const metadata: Metadata = { title: "Repartizări" };

export default async function AssignmentsPage() {
  const actor = await getPageActor();
  const year = await getActiveAcademicYear();
  const [teachers, classes, subjects, modules, assignments, homeroom] = await Promise.all([
    load(listAssignableTeachers(actor)),
    load(listClasses(actor)),
    load(listSubjects(actor)),
    load(listModules(actor)),
    load(listTeachingAssignments(actor, { academicYearId: year?.id })),
    load(listHomeroomAssignments(actor, { academicYearId: year?.id })),
  ]);
  const teacherOptions = teachers.map((t) => ({ value: t.id, label: personName(t) }));
  const classOptions = classes.filter((c) => c.active).map((c) => ({ value: c.id, label: `${c.code} (${c.company.name})` }));
  const subjectOptions = subjects.filter((s) => s.active && s.type !== "CONDUCT").map((s) => ({ value: s.id, label: s.name }));
  const moduleOptions = modules.filter((m) => m.status !== "CLOSED").map((m) => ({ value: m.id, label: `${m.name} – anul ${m.yearOfStudy === 1 ? "I" : "II"}` }));

  return (
    <>
      <PageHeader
        title="Repartizări"
        subtitle={`Profesor → materie → modul → clasă → an școlar${year ? ` (${year.name})` : ""}. Repartizările nu se șterg: se încheie, iar istoricul rămâne.`}
      />
      {!year ? (
        <Card><EmptyState title="Nu există un an școlar activ." /></Card>
      ) : (
        <>
          <div className="mb-6 grid gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Repartizare profesor" description="Predare, instruire practică sau examinator de modul. Un profesor poate avea oricâte materii și clase." />
              <ApiForm
                action="/api/admin/assignments"
                submitLabel="Repartizează"
                successMessage="Repartizarea a fost creată."
                columns={3}
                fields={[
                  { name: "teacherId", label: "Profesor", type: "select", required: true, options: teacherOptions },
                  { name: "subjectId", label: "Materie", type: "select", required: true, options: subjectOptions },
                  { name: "classSectionId", label: "Clasa", type: "select", required: true, options: classOptions },
                  {
                    name: "kind",
                    label: "Tip",
                    type: "select",
                    required: true,
                    options: Object.entries(ASSIGNMENT_KIND_LABEL).map(([value, label]) => ({ value, label })),
                  },
                  { name: "moduleId", label: "Modul", type: "select", options: moduleOptions, emptyLabel: "Toate modulele", hint: "Obligatoriu pentru examinator" },
                ]}
              />
            </Card>
            <Card>
              <CardHeader title="Diriginte" description="Un singur diriginte activ pe clasă" />
              <ApiForm
                action="/api/admin/homeroom-assignments"
                submitLabel="Numește diriginte"
                successMessage="Dirigintele a fost numit."
                columns={2}
                fields={[
                  { name: "teacherId", label: "Profesor", type: "select", required: true, options: teacherOptions, span: 2 },
                  { name: "classSectionId", label: "Clasa", type: "select", required: true, options: classOptions, span: 2 },
                ]}
              />
            </Card>
          </div>

          <Card className="mb-6">
            <CardHeader title="Diriginți" description={`${homeroom.length} clase cu diriginte`} />
            {homeroom.length === 0 ? (
              <EmptyState title="Nu sunt numiți diriginți." />
            ) : (
              <TableWrap>
                <table className="data-table">
                  <thead>
                    <tr><th>Clasa</th><th>Diriginte</th><th>De la</th><th /></tr>
                  </thead>
                  <tbody>
                    {homeroom.map((h) => (
                      <tr key={h.id}>
                        <td className="font-medium">{h.classSection.code}</td>
                        <td>{personName(h.teacher)}</td>
                        <td className="tabular">{formatDate(h.validFrom)}</td>
                        <td className="text-right">
                          <ActionButton action={`/api/admin/homeroom-assignments/${h.id}/end`} label="Încheie" reasonPrompt="Motivul încheierii dirigenției:" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card>
            <CardHeader title="Repartizări active" description={`${assignments.length} repartizări`} />
            {assignments.length === 0 ? (
              <EmptyState title="Nu există repartizări active." />
            ) : (
              <TableWrap>
                <table className="data-table">
                  <thead>
                    <tr><th>Clasa</th><th>Materie</th><th>Profesor</th><th>Tip</th><th>Modul</th><th>De la</th><th /></tr>
                  </thead>
                  <tbody>
                    {assignments.map((a) => (
                      <tr key={a.id}>
                        <td className="font-medium">{a.classSection.code}</td>
                        <td>{a.subject.name}</td>
                        <td>{personName(a.teacher)}</td>
                        <td><Badge tone={a.kind === "MODULE_EXAM" ? "accent" : a.kind === "PRACTICAL_TRAINING" ? "warning" : "primary"}>{ASSIGNMENT_KIND_LABEL[a.kind]}</Badge></td>
                        <td>{a.module?.name ?? "Toate"}</td>
                        <td className="tabular">{formatDate(a.validFrom)}</td>
                        <td className="text-right">
                          <ActionButton action={`/api/admin/assignments/${a.id}/end`} label="Încheie" reasonPrompt="Motivul încheierii repartizării:" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </>
      )}
    </>
  );
}
