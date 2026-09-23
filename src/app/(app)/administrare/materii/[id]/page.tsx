import type { Metadata } from "next";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { ActionButton } from "@/components/admin/api-form";
import { getPageActor, load } from "@/server/http/page";
import { getSubjectOverview } from "@/server/domain/curriculum";
import { ASSIGNMENT_KIND_LABEL, MODULE_STATUS_LABEL, SUBJECT_TYPE_LABEL, personName } from "@/lib/format";

export const metadata: Metadata = { title: "Materie" };

export default async function SubjectAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getPageActor();
  const data = await load(getSubjectOverview(actor, id));
  const s = data.subject;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Materii", href: "/administrare/materii" }, { label: s.name }]}
        title={s.name}
        subtitle={`${SUBJECT_TYPE_LABEL[s.type]} · cod ${s.code}`}
        actions={
          !s.isSystem && (
            <ActionButton
              method="PATCH"
              action={`/api/admin/subjects/${s.id}`}
              body={{ active: !s.active }}
              label={s.active ? "Dezactivează" : "Activează"}
              confirmText={s.active ? "Dezactivați materia? Notele existente rămân neschimbate." : "Activați materia?"}
            />
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Module în care se studiază" description="Anul școlar activ" />
          {data.modules.length === 0 ? (
            <EmptyState title="Materia nu este inclusă în niciun modul." />
          ) : (
            <ul className="divide-y divide-border">
              {data.modules.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span>{m.module.name} · anul {m.module.yearOfStudy === 1 ? "I" : "II"}</span>
                  <span className="flex gap-2">
                    {m.hasFinalExam && <Badge tone="accent">Examen final</Badge>}
                    <Badge>{MODULE_STATUS_LABEL[m.module.status]}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Clase și profesori" description="Repartizări active" />
          {data.assignments.length === 0 ? (
            <EmptyState title="Nicio repartizare activă." />
          ) : (
            <TableWrap>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Clasa</th>
                    <th>Profesor</th>
                    <th>Tip</th>
                    <th>Modul</th>
                  </tr>
                </thead>
                <tbody>
                  {data.assignments.map((a) => (
                    <tr key={a.id}>
                      <td className="font-medium">{a.classSection.code}</td>
                      <td>{personName(a.teacher)}</td>
                      <td>{ASSIGNMENT_KIND_LABEL[a.kind]}</td>
                      <td>{a.module?.name ?? "Toate"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
