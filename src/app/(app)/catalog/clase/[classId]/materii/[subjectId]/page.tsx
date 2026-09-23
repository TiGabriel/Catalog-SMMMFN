import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, GradePill, PageHeader, TableWrap } from "@/components/ui";
import { getPageContext, load } from "@/server/http/page";
import { getClassOverview, getClassSubjectGrades } from "@/server/domain/catalog";
import { listGradeReasons } from "@/server/domain/curriculum";
import { GRADE_KIND_LABEL, SUBJECT_TYPE_LABEL, formatDate, formatGrade, isoToday, personName } from "@/lib/format";
import { GradeEntryForm } from "@/components/catalog/grade-entry-form";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "Materie" };

export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string; subjectId: string }>;
  searchParams: Promise<{ modul?: string }>;
}) {
  const [{ classId, subjectId }, sp] = await Promise.all([params, searchParams]);
  const { actor, caps } = await getPageContext();
  const overview = await load(getClassOverview(actor, classId));
  const subject = overview.subjects.find((s) => s.id === subjectId);
  const moduleFilter = overview.modules.find((m) => m.id === sp.modul)?.id;
  const data = await load(getClassSubjectGrades(actor, classId, subjectId, moduleFilter));
  if (!subject) return null;

  // Modules where this subject is taught (conduct is part of every module).
  const subjectModules = overview.modules.filter((m) => subject.type === "CONDUCT" || m.subjects.some((ms) => ms.subjectId === subjectId));
  const entryModules = subjectModules
    .filter((m) => m.status === "OPEN")
    .map((m) => ({
      id: m.id,
      name: m.name,
      kinds: subject.entry
        .filter((e) => e.moduleId === null || e.moduleId === m.id)
        .map((e) => e.kind)
        .filter((k) => k !== "MODULE_EXAM" || m.subjects.some((ms) => ms.subjectId === subjectId && ms.hasFinalExam)),
    }))
    .filter((m) => m.kinds.length > 0);
  const reasons = caps.introducereNote && entryModules.length ? await listGradeReasons(actor) : [];

  const hasExam = data.students.some((s) => s.grades.some((g) => g.kind === "MODULE_EXAM"));
  const title = `${data.subject.name} – clasa ${overview.class.code}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: caps.catalogGeneral ? "Catalog" : "Clasele mele", href: "/catalog" },
          { label: `Clasa ${overview.class.code}`, href: `/catalog/clase/${classId}` },
          { label: data.subject.name },
        ]}
        title={title}
        subtitle={`${SUBJECT_TYPE_LABEL[data.subject.type]} · An școlar ${overview.class.academicYear.name}${subject.teachers.length ? ` · ${subject.teachers.join(", ")}` : ""}`}
        actions={<PrintButton />}
      />
      <div className="print-only mb-4">
        <p className="text-sm">Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”</p>
        <p className="text-lg font-bold">{title}</p>
      </div>

      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Modul:</span>
        <Link href={`?`} className={`rounded-full border px-3 py-1 text-sm transition-colors ${!moduleFilter ? "border-primary bg-primary text-primary-contrast" : "border-border hover:bg-surface-2"}`}>
          Toate
        </Link>
        {subjectModules.map((m) => (
          <Link key={m.id} href={`?modul=${m.id}`} className={`rounded-full border px-3 py-1 text-sm transition-colors ${moduleFilter === m.id ? "border-primary bg-primary text-primary-contrast" : "border-border hover:bg-surface-2"}`}>
            {m.name}
          </Link>
        ))}
      </div>

      {entryModules.length > 0 && (
        <Card className="no-print mb-6">
          <CardHeader title="Adaugă notă" description="Nota este înregistrată cu numele dumneavoastră ca autor și apare în jurnalul de audit." />
          <GradeEntryForm
            classSectionId={classId}
            subjectId={subjectId}
            students={data.students.map((s) => ({ id: s.id, name: `${s.lastName} ${s.firstName}` }))}
            modules={entryModules}
            reasons={reasons.map((r) => ({ id: r.id, label: r.label, appliesTo: r.appliesTo }))}
            today={isoToday()}
          />
        </Card>
      )}

      <Card className="print-plain">
        <CardHeader title="Note" description="Apăsați pe o notă pentru detalii și istoric" className="no-print" />
        {data.students.length === 0 ? (
          <EmptyState title="Clasa nu are elevi înmatriculați." />
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sticky-col w-10">Nr.</th>
                  <th className="sticky-col left-10">Elev</th>
                  <th>{data.subject.type === "CONDUCT" ? "Notă purtare" : "Note curente"}</th>
                  {hasExam && <th>Examen modul</th>}
                  {data.subject.type !== "CONDUCT" && <th className="text-right">Media notelor (informativ)</th>}
                </tr>
              </thead>
              <tbody>
                {data.students.map((s, i) => {
                  const current = s.grades.filter((g) => g.kind !== "MODULE_EXAM");
                  const exam = s.grades.filter((g) => g.kind === "MODULE_EXAM");
                  const avg = current.filter((g) => g.kind === "CURRENT").map((g) => g.value);
                  return (
                    <tr key={s.id}>
                      <td className="tabular text-muted">{i + 1}</td>
                      <td className="font-medium whitespace-nowrap">
                        <Link href={`/catalog/elevi/${s.id}`} className="hover:text-primary hover:underline">
                          {s.lastName} {s.firstName}
                        </Link>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          {current.length === 0 && <span className="text-muted">—</span>}
                          {current.map((g) => (
                            <Link
                              key={g.id}
                              href={`/catalog/note/${g.id}`}
                              title={`${formatDate(g.gradeDate)} · ${g.reason?.label ?? GRADE_KIND_LABEL[g.kind]} · ${personName(g.author)}${g.module ? ` · ${g.module.name}` : ""}`}
                              className="rounded-lg transition-transform hover:scale-110"
                            >
                              <GradePill value={g.value} />
                            </Link>
                          ))}
                        </div>
                      </td>
                      {hasExam && (
                        <td>
                          {exam.map((g) => (
                            <Link key={g.id} href={`/catalog/note/${g.id}`} title={formatDate(g.gradeDate)}>
                              <GradePill value={g.value} />
                            </Link>
                          ))}
                        </td>
                      )}
                      {data.subject.type !== "CONDUCT" && (
                        <td className="tabular text-right text-muted">
                          {avg.length ? formatGrade(Math.round((avg.reduce((a, b) => a + b, 0) / avg.length) * 100) / 100) : "—"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {subject.entry.length === 0 && caps.introducereNote && (
        <p className="no-print mt-4 text-sm text-muted">
          <Badge tone="neutral">Doar citire</Badge> Nu sunteți repartizat pentru a nota la această materie.
        </p>
      )}
    </>
  );
}
