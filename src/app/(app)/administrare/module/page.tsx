import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { ActionButton, ApiForm } from "@/components/admin/api-form";
import { getPageActor, load } from "@/server/http/page";
import { listModules } from "@/server/domain/curriculum";
import { listAcademicYears } from "@/server/domain/academic";
import { MODULE_STATUS_LABEL, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Module" };

export default async function ModulesAdminPage({ searchParams }: { searchParams: Promise<{ an?: string }> }) {
  const sp = await searchParams;
  const actor = await getPageActor();
  const years = await load(listAcademicYears(actor));
  const year = years.find((y) => y.id === sp.an) ?? years.find((y) => y.status === "ACTIVE") ?? years[0];
  const modules = year ? await load(listModules(actor, year.id)) : [];

  return (
    <>
      <PageHeader title="Module" subtitle="Modulele fiecărui an de studiu și planul lor de materii" />
      <div className="mb-4 flex flex-wrap gap-2">
        {years.map((y) => (
          <Link key={y.id} href={`?an=${y.id}`} className={`rounded-full border px-3 py-1 text-sm ${y.id === year?.id ? "border-primary bg-primary text-primary-contrast" : "border-border hover:bg-surface-2"}`}>
            {y.name}
          </Link>
        ))}
      </div>
      {year && year.status !== "CLOSED" && (
        <Card className="mb-6">
          <CardHeader title="Adaugă modul" description={`An școlar ${year.name}`} />
          <ApiForm
            action="/api/admin/modules"
            submitLabel="Adaugă"
            successMessage="Modulul a fost creat (stare: planificat)."
            columns={4}
            extra={{ academicYearId: year.id }}
            fields={[
              { name: "yearOfStudy", label: "An de studiu", type: "select", required: true, numeric: true, options: [{ value: "1", label: "Anul I (Compania 2)" }, { value: "2", label: "Anul II (Compania 1)" }] },
              { name: "name", label: "Denumire", type: "text", required: true, placeholder: "Modulul 1" },
              { name: "order", label: "Ordine", type: "number", required: true, min: 1, max: 20 },
              { name: "startDate", label: "Început", type: "date" },
              { name: "endDate", label: "Sfârșit", type: "date" },
            ]}
          />
        </Card>
      )}
      <Card>
        <CardHeader title={`${modules.length} module`} />
        {modules.length === 0 ? (
          <EmptyState title="Nu sunt definite module pentru acest an." />
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead>
                <tr>
                  <th>An de studiu</th>
                  <th>Modul</th>
                  <th>Perioadă</th>
                  <th>Stare</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {modules.map((m) => (
                  <tr key={m.id}>
                    <td>Anul {m.yearOfStudy === 1 ? "I" : "II"}</td>
                    <td className="font-medium">
                      <Link href={`/administrare/module/${m.id}`} className="hover:text-primary hover:underline">{m.name}</Link>
                    </td>
                    <td className="tabular text-muted">{formatDate(m.startDate)} – {formatDate(m.endDate)}</td>
                    <td><Badge tone={m.status === "OPEN" ? "success" : m.status === "PLANNED" ? "warning" : "neutral"}>{MODULE_STATUS_LABEL[m.status]}</Badge></td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/administrare/module/${m.id}`} className="text-sm text-primary hover:underline">Plan materii</Link>
                        {m.status === "PLANNED" && <ActionButton method="PATCH" action={`/api/admin/modules/${m.id}`} body={{ status: "OPEN" }} label="Deschide" confirmText="Deschideți modulul pentru notare?" />}
                        {m.status === "OPEN" && (
                          <ActionButton method="PATCH" action={`/api/admin/modules/${m.id}`} body={{ status: "CLOSED" }} label="Închide" variant="danger" confirmText="Închideți modulul? Rezultatele vor fi înghețate, iar notarea se va opri. Operațiunea nu poate fi anulată." />
                        )}
                      </div>
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
