import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, CalendarDays, ClipboardList, GraduationCap, Inbox, Users } from "lucide-react";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui";
import { getPageContext } from "@/server/http/page";
import { listMyClasses } from "@/server/domain/catalog";
import { getWeekTimetable } from "@/server/domain/timetable";
import { listCorrectionRequests } from "@/server/domain/corrections";
import { DAY_NAMES, isoToday } from "@/lib/format";

export const metadata: Metadata = { title: "Panou" };

export default async function DashboardPage() {
  const { actor, caps } = await getPageContext();
  const greeting = `Bun venit, ${[actor.rankLabel, actor.lastName, actor.firstName].filter(Boolean).join(" ")}`;
  const today = new Date(`${isoToday()}T00:00:00Z`);
  const dow = today.getUTCDay() || 7;

  const classes = caps.claseleMele || caps.catalogGeneral ? await listMyClasses(actor) : [];
  const timetable = caps.orar ? await getWeekTimetable(actor, { week: today }).catch(() => null) : null;
  const todayLessons = timetable?.entries.filter((e) => e.dayOfWeek === dow) ?? [];
  const requests = caps.cereriCorectie ? await listCorrectionRequests(actor, { status: "PENDING" }) : [];

  const subjects = new Map<string, string>();
  for (const c of classes) for (const s of c.subjects) subjects.set(s.id, s.name);
  const homeroom = classes.filter((c) => c.isHomeroom);

  return (
    <>
      <PageHeader title={greeting} subtitle={`Astăzi este ${DAY_NAMES[dow]?.toLowerCase()}, ${new Intl.DateTimeFormat("ro-RO", { dateStyle: "long", timeZone: "UTC" }).format(today)}.`} />

      {caps.claseleMele && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Clase repartizate" value={classes.length} icon={<Users className="h-5 w-5" />} />
          <Stat label="Materii repartizate" value={subjects.size} icon={<BookOpen className="h-5 w-5" />} />
          <Stat label="Ore astăzi" value={todayLessons.length} icon={<CalendarDays className="h-5 w-5" />} />
          <Stat label="Cereri de corecție în așteptare" value={requests.length} icon={<Inbox className="h-5 w-5" />} />
        </div>
      )}
      {caps.catalogGeneral && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Stat label="Clase în anul școlar activ" value={classes.length} icon={<Users className="h-5 w-5" />} />
          <Stat label="Cereri de corecție de soluționat" value={requests.length} icon={<Inbox className="h-5 w-5" />} />
          <Card className="flex flex-col justify-center gap-2 p-5">
            <ButtonLink href="/catalog" variant="secondary">Deschide catalogul</ButtonLink>
            <ButtonLink href="/cereri-corectie" variant="secondary">Cereri de corecție</ButtonLink>
          </Card>
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {caps.claseleMele && (
          <Card className="xl:col-span-2">
            <CardHeader title="Orele de astăzi" description="Din orarul publicat pentru săptămâna curentă" />
            {todayLessons.length === 0 ? (
              <EmptyState title="Nu aveți ore programate astăzi." />
            ) : (
              <ul className="divide-y divide-border">
                {todayLessons.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="flex items-center gap-4">
                      <span className="tabular w-24 text-sm font-semibold text-primary">
                        {l.timeSlot.startTime}–{l.timeSlot.endTime}
                      </span>
                      <div>
                        <p className="font-medium">{l.subject.name}</p>
                        <p className="text-sm text-muted">Clasa {l.classSection.code}{l.room ? ` · Sala ${l.room}` : ""}</p>
                      </div>
                    </div>
                    <ButtonLink href={`/catalog/clase/${l.classSection.id}/materii/${l.subject.id}`} variant="ghost" size="sm">
                      Catalog
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {homeroom.length > 0 && (
          <Card>
            <CardHeader title="Dirigenție" description="Clasa pentru care sunteți diriginte" />
            <div className="flex flex-col gap-3 p-5">
              {homeroom.map((c) => (
                <Link key={c.id} href={`/catalog/clase/${c.id}`} className="flex items-center justify-between rounded-xl border border-border px-4 py-3 transition-colors hover:border-primary/40 hover:bg-surface-2">
                  <span className="flex items-center gap-3">
                    <GraduationCap className="h-5 w-5 text-accent" />
                    <span className="font-semibold">Clasa {c.code}</span>
                  </span>
                  <Badge tone="accent">{c.company}</Badge>
                </Link>
              ))}
            </div>
          </Card>
        )}

        {caps.claseleMele && (
          <Card className={homeroom.length ? "xl:col-span-3" : ""}>
            <CardHeader title="Clasele și materiile mele" />
            {classes.length === 0 ? (
              <EmptyState title="Nu aveți repartizări active." icon={<ClipboardList className="h-6 w-6" />}>
                Repartizările la clase și materii sunt configurate de administrator.
              </EmptyState>
            ) : (
              <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
                {classes.map((c) => (
                  <Link key={c.id} href={`/catalog/clase/${c.id}`}>
                    <Card interactive className="h-full p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-lg font-semibold">Clasa {c.code}</p>
                        {c.isHomeroom && <Badge tone="accent">Diriginte</Badge>}
                      </div>
                      <p className="text-xs text-muted">{c.company} · Anul {c.yearOfStudy === 1 ? "I" : "II"}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {c.subjects.map((s) => (
                          <Badge key={s.id} tone="primary">{s.name}</Badge>
                        ))}
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        )}

        {caps.administrare && (
          <Card className="xl:col-span-3">
            <CardHeader title="Administrare" description="Gestionarea structurii școlii" />
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["/administrare/elevi", "Elevi"],
                ["/administrare/materii", "Materii"],
                ["/administrare/module", "Module"],
                ["/administrare/repartizari", "Repartizări"],
              ].map(([href, label]) => (
                <ButtonLink key={href} href={href!} variant="secondary">{label}</ButtonLink>
              ))}
            </div>
          </Card>
        )}

        {caps.noteleMele && (
          <Card className="xl:col-span-3 p-5">
            <ButtonLink href="/elev">Vezi situația școlară</ButtonLink>
          </Card>
        )}
      </div>
    </>
  );
}
