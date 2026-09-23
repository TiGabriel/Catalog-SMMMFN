import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { ActionButton, ApiForm } from "@/components/admin/api-form";
import { getPageActor, load } from "@/server/http/page";
import { listAcademicYears, listClasses } from "@/server/domain/academic";
import { YEAR_STATUS_LABEL } from "@/lib/format";

export const metadata: Metadata = { title: "Clase" };

export default async function ClassesAdminPage({ searchParams }: { searchParams: Promise<{ an?: string }> }) {
  const sp = await searchParams;
  const actor = await getPageActor();
  const years = await load(listAcademicYears(actor));
  const year = years.find((y) => y.id === sp.an) ?? years.find((y) => y.status === "ACTIVE") ?? years[0];
  const classes = year ? await load(listClasses(actor, year.id)) : [];
  const editable = year && year.status !== "CLOSED";

  return (
    <>
      <PageHeader title="Clase" subtitle="Clasele fiecărui an școlar; clasele anilor încheiați rămân în istoric." />
      <div className="mb-4 flex flex-wrap gap-2">
        {years.map((y) => (
          <Link key={y.id} href={`?an=${y.id}`} className={`rounded-full border px-3 py-1 text-sm ${y.id === year?.id ? "border-primary bg-primary text-primary-contrast" : "border-border hover:bg-surface-2"}`}>
            {y.name} <span className="opacity-70">· {YEAR_STATUS_LABEL[y.status]}</span>
          </Link>
        ))}
      </div>
      {editable && (
        <Card className="mb-6">
          <CardHeader title="Adaugă clasă" description="Codul se formează automat: anul de studiu + sufix (ex. 1 + 12 = 112). Compania rezultă din anul de studiu." />
          <ApiForm
            action="/api/admin/classes"
            submitLabel="Adaugă"
            successMessage="Clasa a fost creată."
            columns={3}
            extra={{ academicYearId: year.id }}
            fields={[
              { name: "yearOfStudy", label: "An de studiu", type: "select", numeric: true, required: true, options: [{ value: "1", label: "Anul I (Compania 2)" }, { value: "2", label: "Anul II (Compania 1)" }] },
              { name: "suffix", label: "Sufix", type: "text", required: true, placeholder: "ex. 16" },
            ]}
          />
        </Card>
      )}
      <Card>
        <CardHeader title={`${classes.length} clase${year ? ` – ${year.name}` : ""}`} />
        {classes.length === 0 ? (
          <EmptyState title="Nu există clase pentru acest an." />
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead><tr><th>Clasa</th><th>Companie</th><th>An de studiu</th><th>Promoție</th><th>Stare</th><th /></tr></thead>
              <tbody>
                {classes.map((c) => (
                  <tr key={c.id}>
                    <td className="font-semibold">
                      <Link href={`/administrare/elevi?an=${year!.id}&clasa=${c.id}`} className="hover:text-primary hover:underline">{c.code}</Link>
                    </td>
                    <td>{c.company.name}</td>
                    <td>Anul {c.yearOfStudy === 1 ? "I" : "II"}</td>
                    <td className="text-sm text-muted">{c.cohort.name}</td>
                    <td>{c.active ? <Badge tone="success">Activă</Badge> : <Badge>Inactivă</Badge>}</td>
                    <td className="text-right">
                      {editable && (
                        <ActionButton method="PATCH" action={`/api/admin/classes/${c.id}`} body={{ active: !c.active }} label={c.active ? "Dezactivează" : "Activează"} confirmText={c.active ? "Dezactivați clasa?" : "Activați clasa?"} />
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
