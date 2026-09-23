import type { Metadata } from "next";
import { Badge, Card, CardHeader, PageHeader, TableWrap } from "@/components/ui";
import { ApiForm } from "@/components/admin/api-form";
import { getPageActor, load } from "@/server/http/page";
import { getStudentAdmin } from "@/server/domain/students";
import { ENROLLMENT_STATUS_LABEL, STUDENT_STATUS_LABEL, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Elev" };

export default async function StudentAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getPageActor();
  const s = await load(getStudentAdmin(actor, id));
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Elevi", href: "/administrare/elevi" }, { label: `${s.lastName} ${s.firstName}` }]}
        title={`${s.lastName} ${s.firstName}`}
        subtitle={`Nr. matricol ${s.registryNumber ?? "—"} · ${STUDENT_STATUS_LABEL[s.status]}${s.user ? ` · cont: ${s.user.username}` : ""}`}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Date de identificare" description="Clasa nu se modifică de aici; elevul rămâne în clasa sa." />
          <ApiForm
            method="PATCH"
            action={`/api/admin/students/${s.id}`}
            submitLabel="Salvează"
            successMessage="Datele au fost actualizate."
            columns={2}
            onSuccessReset={false}
            fields={[
              { name: "lastName", label: "Nume", type: "text", defaultValue: s.lastName },
              { name: "firstName", label: "Prenume", type: "text", defaultValue: s.firstName },
              { name: "registryNumber", label: "Nr. matricol", type: "text", defaultValue: s.registryNumber ?? "" },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Istoric înmatriculări" description="Păstrat integral, inclusiv după absolvire" />
          <TableWrap>
            <table className="data-table">
              <thead><tr><th>An școlar</th><th>Clasa</th><th>Perioadă</th><th>Stare</th></tr></thead>
              <tbody>
                {s.enrollments.map((e) => (
                  <tr key={e.id}>
                    <td>{e.academicYear.name}</td>
                    <td className="font-medium">{e.classSection.code}</td>
                    <td className="tabular text-muted">{formatDate(e.startDate)} – {formatDate(e.endDate)}</td>
                    <td><Badge tone={e.status === "ACTIVE" ? "success" : "neutral"}>{ENROLLMENT_STATUS_LABEL[e.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      </div>
    </>
  );
}
