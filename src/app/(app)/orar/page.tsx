import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { getPageContext, load, requireCap } from "@/server/http/page";
import { getWeekTimetable, weekStart } from "@/server/domain/timetable";
import { listMyClasses } from "@/server/domain/catalog";
import { listClasses } from "@/server/domain/academic";
import { listTeachersForFilter } from "@/server/domain/users";
import { WeekNav } from "@/components/timetable/week-nav";
import { WeekGrid } from "@/components/timetable/week-grid";
import { PrintButton } from "@/components/print-button";
import { FilterSelect } from "@/components/timetable/filter-select";
import { formatDate, isoToday, personName } from "@/lib/format";

export const metadata: Metadata = { title: "Orar" };

const isIso = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isUuid = (s?: string) => !!s && /^[0-9a-f-]{36}$/i.test(s);

export default async function TimetablePage({ searchParams }: { searchParams: Promise<{ saptamana?: string; clasa?: string; profesor?: string }> }) {
  const sp = await searchParams;
  const { actor, caps } = await getPageContext();
  requireCap(caps.orar);
  const global = caps.administrare || caps.catalogGeneral;
  const date = new Date(`${isIso(sp.saptamana) ? sp.saptamana : isoToday()}T00:00:00Z`);
  // Class filter source: administrators use the structure list; commander/diriginte their catalog view.
  const classes = caps.administrare
    ? (await load(listClasses(actor))).map((c) => ({ id: c.id, code: c.code, isHomeroom: false }))
    : global || caps.diriginte
      ? await listMyClasses(actor)
      : [];
  const homeroomClasses = classes.filter((c) => c.isHomeroom);
  const teachers = global ? await listTeachersForFilter(actor) : [];

  const classId = isUuid(sp.clasa) ? sp.clasa : undefined;
  const teacherId = global && isUuid(sp.profesor) ? sp.profesor : undefined;
  const tt = await load(getWeekTimetable(actor, { week: date, classSectionId: classId, teacherId }));
  const current = weekStart(new Date(`${isoToday()}T00:00:00Z`)).toISOString().slice(0, 10);
  const scopeLabel = classId
    ? `Clasa ${classes.find((c) => c.id === classId)?.code ?? ""}`
    : teacherId
      ? personName(teachers.find((t) => t.id === teacherId))
      : global
        ? "Toate clasele"
        : caps.noteleMele
          ? "Clasa mea"
          : "Orele mele";

  return (
    <>
      <PageHeader title="Orar" subtitle={`${scopeLabel} · săptămâna ${tt.parity === "EVEN" ? "pară" : "impară"}`} actions={<PrintButton />} />
      <Card className="no-print mb-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <WeekNav weekStart={tt.weekStart} weekEnd={tt.weekEnd} currentWeekStart={current} />
          <div className="flex flex-wrap items-center gap-2">
            {global && (
              <>
                <FilterSelect param="clasa" label="Clasa" value={classId ?? ""} clears={["profesor"]} options={classes.map((c) => ({ value: c.id, label: c.code }))} />
                <FilterSelect param="profesor" label="Profesor" value={teacherId ?? ""} clears={["clasa"]} options={teachers.map((t) => ({ value: t.id, label: personName(t) }))} />
              </>
            )}
            {!global && homeroomClasses.length > 0 && (
              <div className="flex gap-1.5">
                <Link href={`?saptamana=${tt.weekStart}`} className={`rounded-full border px-3 py-1 text-sm ${!classId ? "border-primary bg-primary text-primary-contrast" : "border-border hover:bg-surface-2"}`}>
                  Orele mele
                </Link>
                {homeroomClasses.map((c) => (
                  <Link key={c.id} href={`?saptamana=${tt.weekStart}&clasa=${c.id}`} className={`rounded-full border px-3 py-1 text-sm ${classId === c.id ? "border-primary bg-primary text-primary-contrast" : "border-border hover:bg-surface-2"}`}>
                    Clasa {c.code}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>
      <div className="print-only mb-2 text-sm">
        Orar – {scopeLabel} – săptămâna {formatDate(tt.weekStart)} – {formatDate(tt.weekEnd)}
      </div>
      {!tt.version ? (
        <Card>
          <EmptyState title="Nu există un orar publicat pentru această săptămână." />
        </Card>
      ) : (
        <Card className="print-plain">
          <CardHeader
            className="no-print"
            title={tt.version.name}
            description={`Valabil din ${formatDate(tt.version.validFrom)}${tt.version.validTo ? ` până la ${formatDate(tt.version.validTo)}` : ""}`}
          />
          {tt.entries.length === 0 ? (
            <EmptyState title="Nu există ore în această săptămână pentru selecția curentă." />
          ) : (
            <WeekGrid slots={tt.slots} entries={tt.entries} showClass={!classId} showTeacher={global || !!classId || caps.noteleMele} />
          )}
          {tt.overrides.length > 0 && (
            <div className="p-4">
              <Alert tone="warning" title="Modificări punctuale în această săptămână">
                <ul className="list-disc pl-4">
                  {tt.overrides.map((o) => (
                    <li key={o.id}>
                      {formatDate(o.date)}, ora {o.timeSlot.index}, clasa {o.classSection.code}: {o.cancelled ? "oră anulată" : `${o.subject?.name ?? ""} ${o.teacher ? `– ${o.teacher.lastName} ${o.teacher.firstName}` : ""}`}
                      {o.note ? ` (${o.note})` : ""}
                    </li>
                  ))}
                </ul>
              </Alert>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
