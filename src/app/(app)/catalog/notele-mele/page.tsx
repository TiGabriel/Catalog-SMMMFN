import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, GradePill, PageHeader, TableWrap } from "@/components/ui";
import { getPageContext, load, requireCap } from "@/server/http/page";
import { listOwnGrades } from "@/server/domain/grades";
import { GRADE_KIND_LABEL, formatDate, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Notele introduse" };

export default async function OwnGradesPage({ searchParams }: { searchParams: Promise<{ sterse?: string }> }) {
  const sp = await searchParams;
  const { actor, caps } = await getPageContext();
  requireCap(caps.introducereNote);
  const includeDeleted = sp.sterse === "1";
  const grades = await load(listOwnGrades(actor, { includeDeleted }));
  return (
    <>
      <PageHeader title="Notele introduse de mine" subtitle="Istoricul notelor al căror autor sunteți (cele mai recente primele)" />
      <Card>
        <CardHeader
          title={`${grades.length} note`}
          actions={
            <Link href={includeDeleted ? "?" : "?sterse=1"} className="text-sm text-primary hover:underline">
              {includeDeleted ? "Ascunde notele șterse" : "Arată și notele șterse"}
            </Link>
          }
        />
        {grades.length === 0 ? (
          <EmptyState title="Nu ați introdus încă nicio notă." />
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data notei</th>
                  <th>Elev</th>
                  <th>Clasa</th>
                  <th>Materie</th>
                  <th>Modul</th>
                  <th>Tip</th>
                  <th>Notă</th>
                  <th>Înregistrată</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => (
                  <tr key={g.id}>
                    <td className="tabular">{formatDate(g.gradeDate)}</td>
                    <td className="font-medium">
                      <Link href={`/catalog/note/${g.id}`} className="hover:text-primary hover:underline">
                        {g.student.lastName} {g.student.firstName}
                      </Link>
                    </td>
                    <td>{g.classSection.code}</td>
                    <td>{g.subject.name}</td>
                    <td>{g.module?.name ?? "—"}</td>
                    <td className="text-sm">{g.reason?.label ?? GRADE_KIND_LABEL[g.kind]}</td>
                    <td>
                      <GradePill value={g.value} muted={g.status === "DELETED"} />
                      {g.status === "DELETED" && <Badge tone="danger" className="ml-1">ștearsă</Badge>}
                    </td>
                    <td className="tabular whitespace-nowrap text-muted">{formatDateTime(g.createdAt)}</td>
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
