import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/admin/api-form";
import { WeekGrid } from "@/components/timetable/week-grid";
import { getPageActor, load } from "@/server/http/page";
import { getTimetableVersion } from "@/server/domain/timetable-admin";
import { listTimeSlotsForGrid } from "@/server/domain/timetable";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Previzualizare orar" };

export default async function TimetableVersionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ clasa?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const actor = await getPageActor();
  const [{ version, diff }, slots] = await Promise.all([load(getTimetableVersion(actor, id)), listTimeSlotsForGrid()]);
  const classes = [...new Map(version.entries.map((e) => [e.classSectionId, e.classSection.code])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const selected = classes.find(([cid]) => cid === sp.clasa)?.[0] ?? classes[0]?.[0];
  const report = version.import?.report as { warnings?: { row: number | null; message: string }[] } | null;
  const entries = version.entries
    .filter((e) => e.classSectionId === selected)
    .map((e) => ({
      ...e,
      subject: { id: e.subjectId, name: e.subject.name },
      classSection: { id: e.classSectionId, code: e.classSection.code },
      timeSlot: { id: e.timeSlotId, ...e.timeSlot },
      groupLabel: [e.groupLabel, e.weekParity === "ODD" ? "săpt. impară" : e.weekParity === "EVEN" ? "săpt. pară" : null].filter(Boolean).join(", ") || null,
    }));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Orar – import", href: "/administrare/orar" }, { label: version.name }]}
        title={version.name}
        subtitle={`An școlar ${version.academicYear.name} · valabil din ${formatDate(version.validFrom)}${version.validTo ? ` până la ${formatDate(version.validTo)}` : ""} · ${version.entries.length} ore`}
        actions={
          <>
            <Badge tone={version.status === "PUBLISHED" ? "success" : version.status === "DRAFT" ? "warning" : "neutral"}>
              {version.status === "PUBLISHED" ? "Publicat" : version.status === "DRAFT" ? "În lucru" : "Arhivat"}
            </Badge>
            {version.status === "DRAFT" && <ActionButton action={`/api/admin/timetable/versions/${version.id}/publish`} label="Publică orarul" variant="primary" confirmText="Publicați această versiune?" />}
          </>
        }
      />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {diff ? (
          <Alert tone="primary" title={`Comparativ cu „${diff.replacedVersion.name}”`}>
            {diff.added} ore noi/modificate · {diff.removed} ore eliminate · {diff.unchanged} neschimbate
          </Alert>
        ) : (
          <Alert tone="primary">Nu există o versiune publicată anterior pentru această perioadă.</Alert>
        )}
        {report?.warnings && report.warnings.length > 0 && (
          <Alert tone="warning" title={`${report.warnings.length} avertismente la import`}>
            <ul className="list-disc pl-4">
              {report.warnings.slice(0, 5).map((w, i) => (
                <li key={i}>{w.row ? `Rândul ${w.row}: ` : ""}{w.message}</li>
              ))}
            </ul>
          </Alert>
        )}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {classes.map(([cid, code]) => (
          <Link key={cid} href={`?clasa=${cid}`} className={`rounded-full border px-3 py-1 text-sm ${cid === selected ? "border-primary bg-primary text-primary-contrast" : "border-border hover:bg-surface-2"}`}>
            {code}
          </Link>
        ))}
      </div>
      <Card>
        <CardHeader title={`Clasa ${classes.find(([cid]) => cid === selected)?.[1] ?? ""}`} />
        <WeekGrid slots={slots} entries={entries} showClass={false} showTeacher />
      </Card>
    </>
  );
}
