import type { Metadata } from "next";
import { Card, CardHeader, EmptyState, GradePill, PageHeader, TableWrap } from "@/components/ui";
import { getPageContext, load, requireCap } from "@/server/http/page";
import { getOwnGrades } from "@/server/domain/catalog";
import { GRADE_KIND_LABEL, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Situația mea școlară" };

/** Student view (only reachable when student accounts are enabled): own grades only. */
export default async function StudentSelfPage() {
  const { actor, caps } = await getPageContext();
  requireCap(caps.noteleMele);
  const data = await load(getOwnGrades(actor));
  const bySubject = new Map<string, { name: string; grades: typeof data.grades }>();
  for (const g of data.grades) {
    const subj = (g as unknown as { subject: { id: string; name: string } }).subject;
    const e = bySubject.get(subj.id) ?? { name: subj.name, grades: [] };
    e.grades.push(g);
    bySubject.set(subj.id, e);
  }
  return (
    <>
      <PageHeader title="Situația mea școlară" subtitle={`Clasa ${data.student.enrollments[0]?.classSection.code ?? "—"}`} />
      <Card>
        <CardHeader title="Note – anul școlar curent" />
        {bySubject.size === 0 ? (
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
                          <span key={g.id} title={`${formatDate(g.gradeDate)} · ${g.reason?.label ?? GRADE_KIND_LABEL[g.kind]}`}>
                            <GradePill value={g.value} />
                          </span>
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
