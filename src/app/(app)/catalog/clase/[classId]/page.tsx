import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { getPageContext, load } from "@/server/http/page";
import { getClassOverview } from "@/server/domain/catalog";
import { MODULE_STATUS_LABEL, SUBJECT_TYPE_LABEL, personName } from "@/lib/format";

export const metadata: Metadata = { title: "Clasa" };

export default async function ClassPage({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  const { actor, caps } = await getPageContext();
  const data = await load(getClassOverview(actor, classId));
  const c = data.class;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: caps.catalogGeneral ? "Catalog" : "Clasele mele", href: "/catalog" }, { label: `Clasa ${c.code}` }]}
        title={`Clasa ${c.code}`}
        subtitle={`${c.company} · Anul ${c.yearOfStudy === 1 ? "I" : "II"} · An școlar ${c.academicYear.name}${c.homeroomTeacher ? ` · Diriginte: ${personName(c.homeroomTeacher)}` : ""}`}
        actions={data.isHomeroom ? <Badge tone="accent">Sunteți dirigintele clasei</Badge> : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Materii" description={data.isHomeroom || caps.catalogGeneral ? "Toate materiile clasei" : "Materiile la care sunteți repartizat"} />
          {data.subjects.length === 0 ? (
            <EmptyState title="Nicio materie vizibilă." />
          ) : (
            <ul className="divide-y divide-border">
              {data.subjects.map((s) => (
                <li key={s.id}>
                  <Link href={`/catalog/clase/${c.id}/materii/${s.id}`} className="group flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-surface-2">
                    <div className="min-w-0">
                      <p className="font-medium group-hover:text-primary">{s.name}</p>
                      <p className="truncate text-xs text-muted">
                        {SUBJECT_TYPE_LABEL[s.type]}
                        {s.teachers.length ? ` · ${s.teachers.join(", ")}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.canEnterGrades && <Badge tone="success">Puteți nota</Badge>}
                      <ChevronRight className="h-4 w-4 text-muted" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Module" description="Anul școlar curent" />
          {data.modules.length === 0 ? (
            <EmptyState title="Nu sunt definite module." />
          ) : (
            <ul className="divide-y divide-border">
              {data.modules.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="font-medium">{m.name}</p>
                    <Badge tone={m.status === "OPEN" ? "success" : m.status === "CLOSED" ? "neutral" : "warning"}>{MODULE_STATUS_LABEL[m.status]}</Badge>
                  </div>
                  {data.canSeeResults && (
                    <ButtonLink href={`/catalog/clase/${c.id}/rezultate/${m.id}`} variant="secondary" size="sm">
                      Rezultate
                    </ButtonLink>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Elevi" description={`${data.students.length} elevi înmatriculați`} />
          {data.students.length === 0 ? (
            <EmptyState title="Clasa nu are elevi înmatriculați." />
          ) : (
            <TableWrap>
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-12">Nr.</th>
                    <th>Nume și prenume</th>
                    <th>Nr. matricol</th>
                    <th className="no-print" />
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s, i) => (
                    <tr key={s.id}>
                      <td className="tabular text-muted">{i + 1}</td>
                      <td className="font-medium">{s.lastName} {s.firstName}</td>
                      <td className="tabular text-muted">{s.registryNumber ?? "—"}</td>
                      <td className="no-print text-right">
                        <Link href={`/catalog/elevi/${s.id}`} className="text-sm text-primary hover:underline">
                          Situație școlară
                        </Link>
                      </td>
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
