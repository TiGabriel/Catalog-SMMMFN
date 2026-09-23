import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, GradePill, PageHeader, TableWrap } from "@/components/ui";
import { getPageContext, load } from "@/server/http/page";
import { getModuleResults } from "@/server/domain/results";
import { formatDateTime } from "@/lib/format";
import { PrintButton } from "@/components/print-button";

export const metadata: Metadata = { title: "Rezultatele modulului" };

export default async function ModuleResultsPage({ params }: { params: Promise<{ classId: string; moduleId: string }> }) {
  const { classId, moduleId } = await params;
  const { actor, caps } = await getPageContext();
  const t = await load(getModuleResults(actor, classId, moduleId));
  const regular = t.subjects.filter((s) => s.type !== "CONDUCT" && s.type !== "PRACTICAL_TRAINING");
  const practical = t.subjects.filter((s) => s.type === "PRACTICAL_TRAINING");
  const title = `Rezultatele modulului – ${t.module.name}, clasa ${t.classSection.code}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: caps.catalogGeneral ? "Catalog" : "Clasele mele", href: "/catalog" },
          { label: `Clasa ${t.classSection.code}`, href: `/catalog/clase/${classId}` },
          { label: t.module.name },
        ]}
        title={title}
        subtitle={t.frozen ? `Rezultate finale înghețate la închiderea modulului (${formatDateTime(t.computedAt)})` : "Calcul provizoriu, actualizat la fiecare accesare"}
        actions={<PrintButton />}
      />
      <div className="print-only mb-3">
        <p className="text-sm">Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”</p>
        <p className="text-lg font-bold">{title}</p>
      </div>
      {t.ruleSet.provisional && (
        <div className="no-print mb-4">
          <Alert tone="warning" title="Reguli de calcul provizorii">
            Regulile oficiale de calcul al mediilor nu au fost încă stabilite. Valorile afișate folosesc setul „{t.ruleSet.name}” și pot fi recalculate după configurarea regulilor finale.
          </Alert>
        </div>
      )}
      <Card className="print-plain">
        <CardHeader
          className="no-print"
          title="Tabel de rezultate"
          description={`Set de reguli: ${t.ruleSet.name}${t.ruleSet.version ? ` (v${t.ruleSet.version})` : ""}`}
          actions={t.frozen ? <Badge tone="neutral">Modul închis</Badge> : <Badge tone="warning">Provizoriu</Badge>}
        />
        <TableWrap>
          <table className="data-table">
            <thead>
              <tr>
                <th className="sticky-col">Elev</th>
                {regular.map((s) => (
                  <th key={s.id} className="text-center">{s.name}{s.hasFinalExam ? " *" : ""}</th>
                ))}
                {practical.length > 0 && <th className="text-center">Instruire practică</th>}
                <th className="text-center">Purtare</th>
                <th className="text-center">Media modulului</th>
                <th className="no-print">Observații</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.studentId}>
                  <td className="sticky-col whitespace-nowrap font-medium">{r.lastName} {r.firstName}</td>
                  {regular.map((s) => {
                    const sr = r.subjects.find((x) => x.subjectId === s.id);
                    return (
                      <td key={s.id} className="text-center" title={sr ? `Media notelor: ${sr.currentMean ?? "—"}${s.hasFinalExam ? ` · Examen: ${sr.exam ?? "—"}` : ""}` : undefined}>
                        <GradePill value={sr?.final ?? null} />
                      </td>
                    );
                  })}
                  {practical.length > 0 && <td className="text-center"><GradePill value={r.practicalTraining} /></td>}
                  <td className="text-center"><GradePill value={r.conduct} /></td>
                  <td className="text-center font-semibold"><GradePill value={r.moduleAverage} /></td>
                  <td className="no-print max-w-xs text-xs text-muted">{r.missing.join("; ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <p className="px-5 py-3 text-xs text-muted">* materie cu examen final de modul</p>
      </Card>
    </>
  );
}
