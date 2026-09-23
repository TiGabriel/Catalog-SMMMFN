import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, EmptyState, GradePill, PageHeader, TableWrap } from "@/components/ui";
import { getPageContext, load } from "@/server/http/page";
import { getStudentOverview } from "@/server/domain/catalog";
import { GRADE_KIND_LABEL, STUDENT_STATUS_LABEL, formatDate } from "@/lib/format";
import { PrintButton } from "@/components/print-button";
import { ButtonLink } from "@/components/ui";

export const metadata: Metadata = { title: "Situația elevului" };

export default async function StudentPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const { actor, caps } = await getPageContext();
  const data = await load(getStudentOverview(actor, studentId));
  const s = data.student;
  const bySubject = new Map<string, { name: string; grades: typeof data.grades }>();
  for (const g of data.grades) {
    const subj = (g as unknown as { subject: { id: string; name: string } }).subject;
    const entry = bySubject.get(subj.id) ?? { name: subj.name, grades: [] };
    entry.grades.push(g);
    bySubject.set(subj.id, entry);
  }
  const cls = s.enrollments[0]?.classSection;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: caps.catalogGeneral ? "Catalog" : "Clasele mele", href: "/catalog" },
          ...(cls ? [{ label: `Clasa ${cls.code}`, href: `/catalog/clase/${cls.id}` }] : []),
          { label: `${s.lastName} ${s.firstName}` },
        ]}
        title={`${s.rank?.label ? s.rank.label + " " : ""}${s.lastName} ${s.firstName}`}
        subtitle={`${cls ? `Clasa ${cls.code} · ` : ""}Nr. matricol ${s.registryNumber ?? "—"} · ${STUDENT_STATUS_LABEL[s.status]}`}
        actions={
          <>
            {data.gradesVisible && <ButtonLink href={`/rapoarte/situatie-elev?elev=${s.id}`} variant="secondary">Raport situație</ButtonLink>}
            {caps.catalogGeneral && <ButtonLink href={`/rapoarte/foaie-matricola?elev=${s.id}`} variant="secondary">Foaie matricolă</ButtonLink>}
            <PrintButton />
          </>
        }
      />
      <Card className="print-plain">
        <CardHeader title="Situația școlară – anul curent" description={caps.catalogGeneral ? "Toate materiile" : "Materiile pe care le puteți vedea"} className="no-print" />
        {!data.gradesVisible ? (
          <EmptyState title="Nu aveți acces la notele acestui elev." />
        ) : bySubject.size === 0 ? (
          <EmptyState title="Nu există note înregistrate." />
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Materie</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {[...bySubject.values()].map((row) => (
                  <tr key={row.name}>
                    <td className="font-medium">{row.name}</td>
                    <td>
                      <div className="flex flex-wrap gap-1.5">
                        {row.grades.map((g) => (
                          <Link
                            key={g.id}
                            href={`/catalog/note/${g.id}`}
                            title={`${formatDate(g.gradeDate)} · ${g.reason?.label ?? GRADE_KIND_LABEL[g.kind]}${g.module ? ` · ${g.module.name}` : ""}`}
                          >
                            <GradePill value={g.value} />
                          </Link>
                        ))}
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
