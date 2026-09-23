import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { ActionButton } from "@/components/admin/api-form";
import { TimetableUploadForm } from "@/components/timetable/upload-form";
import { getPageActor, load } from "@/server/http/page";
import { listAcademicYears } from "@/server/domain/academic";
import { listTimetableImports, listTimetableVersions } from "@/server/domain/timetable-admin";
import { formatDate, formatDateTime, isoToday } from "@/lib/format";

export const metadata: Metadata = { title: "Import orar" };

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "danger" }> = {
  DRAFT: { label: "În lucru", tone: "warning" },
  PUBLISHED: { label: "Publicat", tone: "success" },
  ARCHIVED: { label: "Arhivat", tone: "neutral" },
};

export default async function TimetableAdminPage() {
  const actor = await getPageActor();
  const years = (await load(listAcademicYears(actor))).filter((y) => y.status !== "CLOSED");
  const active = years.find((y) => y.status === "ACTIVE") ?? years[0];
  const [versions, imports] = await Promise.all([load(listTimetableVersions(actor)), load(listTimetableImports(actor))]);

  return (
    <>
      <PageHeader
        title="Orar – import și versiuni"
        subtitle="Încărcați orarul din șablonul Excel, verificați raportul de validare, previzualizați și publicați. Versiunile anterioare nu se pierd."
        actions={
          active && (
            <ButtonLink href={`/api/admin/timetable/template?academicYearId=${active.id}`} variant="secondary" prefetch={false}>
              <Download className="h-4 w-4" /> Descarcă șablonul
            </ButtonLink>
          )
        }
      />
      {active ? (
        <Card className="mb-6">
          <CardHeader title="Încarcă un orar" description="Formatul este descris în foaia „Instrucțiuni” din șablon (și în docs/ORAR_IMPORT.md)." />
          <TimetableUploadForm years={years.map((y) => ({ id: y.id, name: y.name }))} defaultYearId={active.id} today={isoToday()} />
        </Card>
      ) : (
        <Card className="mb-6"><EmptyState title="Nu există un an școlar deschis." /></Card>
      )}

      <Card className="mb-6">
        <CardHeader title="Versiuni de orar" description="Pentru fiecare săptămână se afișează versiunea publicată cu cea mai recentă dată de început. Arhivarea unei versiuni readuce automat versiunea anterioară." />
        {versions.length === 0 ? (
          <EmptyState title="Nu există versiuni." />
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead>
                <tr><th>Denumire</th><th>An școlar</th><th>Valabilitate</th><th>Ore</th><th>Stare</th><th>Publicat</th><th /></tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td className="font-medium">
                      <Link href={`/administrare/orar/${v.id}`} className="hover:text-primary hover:underline">{v.name}</Link>
                    </td>
                    <td>{v.academicYear.name}</td>
                    <td className="tabular whitespace-nowrap">{formatDate(v.validFrom)} – {v.validTo ? formatDate(v.validTo) : "…"}</td>
                    <td className="tabular">{v._count.entries}</td>
                    <td><Badge tone={STATUS[v.status]!.tone}>{STATUS[v.status]!.label}</Badge></td>
                    <td className="text-sm text-muted">{v.publishedAt ? `${formatDateTime(v.publishedAt)}` : "—"}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        {v.status === "DRAFT" && <ActionButton action={`/api/admin/timetable/versions/${v.id}/publish`} label="Publică" variant="primary" confirmText="Publicați această versiune de orar?" />}
                        {v.status === "PUBLISHED" && <ActionButton action={`/api/admin/timetable/versions/${v.id}/archive`} label="Arhivează" confirmText="Arhivați versiunea? Versiunea publicată anterioară va redeveni activă." />}
                        {v.status === "ARCHIVED" && v.publishedAt && <ActionButton action={`/api/admin/timetable/versions/${v.id}/republish`} label="Restaurează" confirmText="Publicați din nou această versiune?" />}
                        {v.status === "DRAFT" && <ActionButton action={`/api/admin/timetable/versions/${v.id}/archive`} label="Renunță" variant="ghost" confirmText="Renunțați la această versiune în lucru?" />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card>
        <CardHeader title="Istoric încărcări" description="Ultimele 30 de fișiere încărcate (fișierele sunt păstrate pentru trasabilitate)" />
        {imports.length === 0 ? (
          <EmptyState title="Nu au fost încărcate fișiere." />
        ) : (
          <TableWrap>
            <table className="data-table">
              <thead><tr><th>Fișier</th><th>Încărcat</th><th>De</th><th>Rezultat</th></tr></thead>
              <tbody>
                {imports.map((i) => {
                  const r = i.report as { lessons?: number; errors?: unknown[] } | null;
                  return (
                    <tr key={i.id}>
                      <td className="font-medium">{i.fileName}</td>
                      <td className="text-sm">{formatDateTime(i.uploadedAt)}</td>
                      <td className="text-sm">{i.uploadedBy.lastName} {i.uploadedBy.firstName}</td>
                      <td>{i.status === "FAILED" ? <Badge tone="danger">{r?.errors?.length ?? 0} erori</Badge> : <Badge tone="success">{r?.lessons ?? 0} ore</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
