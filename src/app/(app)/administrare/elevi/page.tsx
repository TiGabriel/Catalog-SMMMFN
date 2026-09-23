import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { ApiForm } from "@/components/admin/api-form";
import { getPageActor, load } from "@/server/http/page";
import { listAcademicYears, listClasses } from "@/server/domain/academic";
import { listStudentsAdmin } from "@/server/domain/students";
import { STUDENT_STATUS_LABEL } from "@/lib/format";

export const metadata: Metadata = { title: "Elevi" };

export default async function StudentsAdminPage({ searchParams }: { searchParams: Promise<{ clasa?: string; an?: string }> }) {
  const sp = await searchParams;
  const actor = await getPageActor();
  const years = await load(listAcademicYears(actor));
  const year = years.find((y) => y.id === sp.an) ?? years.find((y) => y.status === "ACTIVE") ?? years[0];
  const classes = year ? await load(listClasses(actor, year.id)) : [];
  const selected = classes.find((c) => c.id === sp.clasa) ?? classes[0];
  const historical = year?.status === "CLOSED";
  const students = selected ? await load(listStudentsAdmin(actor, selected.id, historical)) : [];

  return (
    <>
      <PageHeader title="Elevi" subtitle="Elevii rămân în clasa lor; trecerea în anul II se face automat, iar istoricul se păstrează." />
      <div className="mb-3 flex flex-wrap gap-2">
        {years.map((y) => (
          <Link key={y.id} href={`?an=${y.id}`} className={`rounded-full border px-3 py-1 text-sm ${y.id === year?.id ? "border-accent bg-accent-soft font-medium" : "border-border hover:bg-surface-2"}`}>
            {y.name}
          </Link>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {classes.map((c) => (
          <Link key={c.id} href={`?an=${year!.id}&clasa=${c.id}`} className={`rounded-full border px-3 py-1 text-sm ${c.id === selected?.id ? "border-primary bg-primary text-primary-contrast" : "border-border hover:bg-surface-2"}`}>
            {c.code}
          </Link>
        ))}
      </div>
      {selected && (
        <>
          {!historical && (
          <Card className="mb-6">
            <CardHeader title={`Adaugă elev în clasa ${selected.code}`} description={`An școlar ${selected.academicYear.name}`} />
            <ApiForm
              action="/api/admin/students"
              submitLabel="Adaugă elevul"
              successMessage="Elevul a fost înmatriculat."
              columns={4}
              extra={{ classSectionId: selected.id }}
              fields={[
                { name: "lastName", label: "Nume", type: "text", required: true },
                { name: "firstName", label: "Prenume", type: "text", required: true },
                { name: "registryNumber", label: "Nr. matricol (identificator intern)", type: "text" },
              ]}
            />
          </Card>
          )}
          <Card>
            <CardHeader title={`Clasa ${selected.code} – ${students.length} elevi`} description={historical ? `An școlar încheiat (${year!.name}) – doar consultare` : undefined} />
            {students.length === 0 ? (
              <EmptyState title="Clasa nu are elevi." />
            ) : (
              <TableWrap>
                <table className="data-table">
                  <thead>
                    <tr><th>Nr.</th><th>Nume și prenume</th><th>Nr. matricol</th><th>Stare</th></tr>
                  </thead>
                  <tbody>
                    {students.map((s, i) => (
                      <tr key={s.id}>
                        <td className="tabular text-muted">{i + 1}</td>
                        <td className="font-medium">
                          <Link href={`/administrare/elevi/${s.id}`} className="hover:text-primary hover:underline">{s.lastName} {s.firstName}</Link>
                        </td>
                        <td className="tabular">{s.registryNumber ?? "—"}</td>
                        <td><Badge tone={s.status === "ACTIVE" ? "success" : "neutral"}>{STUDENT_STATUS_LABEL[s.status]}</Badge></td>
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
