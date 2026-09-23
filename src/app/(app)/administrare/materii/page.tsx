import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader, TableWrap } from "@/components/ui";
import { ApiForm } from "@/components/admin/api-form";
import { getPageActor, load } from "@/server/http/page";
import { listSubjects } from "@/server/domain/curriculum";
import { SUBJECT_TYPE_LABEL } from "@/lib/format";

export const metadata: Metadata = { title: "Materii" };

export default async function SubjectsAdminPage() {
  const actor = await getPageActor();
  const subjects = await load(listSubjects(actor));
  return (
    <>
      <PageHeader title="Materii" subtitle="Materii de cultură generală, de specialitate și instruire practică" />
      <Card className="mb-6">
        <CardHeader title="Adaugă materie" />
        <ApiForm
          action="/api/admin/subjects"
          submitLabel="Adaugă"
          successMessage="Materia a fost adăugată."
          columns={4}
          fields={[
            { name: "code", label: "Cod", type: "text", required: true, placeholder: "ex. NAV", hint: "Litere mari, cifre, - sau _" },
            { name: "name", label: "Denumire", type: "text", required: true },
            { name: "shortName", label: "Abreviere", type: "text" },
            {
              name: "type",
              label: "Tip",
              type: "select",
              required: true,
              options: [
                { value: "GENERAL", label: SUBJECT_TYPE_LABEL.GENERAL! },
                { value: "SPECIALIZATION", label: SUBJECT_TYPE_LABEL.SPECIALIZATION! },
                { value: "PRACTICAL_TRAINING", label: SUBJECT_TYPE_LABEL.PRACTICAL_TRAINING! },
              ],
            },
          ]}
        />
      </Card>
      <Card>
        <CardHeader title={`${subjects.length} materii`} />
        <TableWrap>
          <table className="data-table">
            <thead>
              <tr>
                <th>Cod</th>
                <th>Denumire</th>
                <th>Tip</th>
                <th>Stare</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.id}>
                  <td className="tabular text-muted">{s.code}</td>
                  <td className="font-medium">
                    <Link href={`/administrare/materii/${s.id}`} className="hover:text-primary hover:underline">{s.name}</Link>
                    {s.isSystem && <Badge tone="accent" className="ml-2">sistem</Badge>}
                  </td>
                  <td>{SUBJECT_TYPE_LABEL[s.type]}</td>
                  <td>{s.active ? <Badge tone="success">Activă</Badge> : <Badge>Inactivă</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
