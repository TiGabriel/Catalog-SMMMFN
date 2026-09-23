import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle, Archive, BookOpen, CalendarDays, ClipboardList, FileText, GraduationCap, Grid3x3, Inbox, Layers, Link2, Settings, ShieldCheck, Upload, Users,
} from "lucide-react";
import { Alert, Badge, ButtonLink, Card, CardHeader, EmptyState, GradePill, PageHeader, Stat } from "@/components/ui";
import { getPageContext } from "@/server/http/page";
import { listMyClasses } from "@/server/domain/catalog";
import { getWeekTimetable } from "@/server/domain/timetable";
import { adminDashboard, commanderDashboard, teacherDashboard } from "@/server/domain/dashboard";
import { AUDIT_ACTION_LABEL, DAY_NAMES, formatDateTime, isoToday, plural } from "@/lib/format";

export const metadata: Metadata = { title: "Panou" };

function QuickLink({ href, label, icon: Icon, hint }: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; hint?: string }) {
  return (
    <Link href={href} className="group rounded-2xl">
      <Card interactive className="flex h-full items-center gap-3 p-4">
        <span className="rounded-xl bg-info-soft p-2.5 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-contrast">
          <Icon className="h-5 w-5" />
        </span>
        <span>
          <span className="block font-medium">{label}</span>
          {hint && <span className="block text-xs text-muted">{hint}</span>}
        </span>
      </Card>
    </Link>
  );
}

export default async function DashboardPage() {
  const { actor, caps } = await getPageContext();
  const name = [actor.rankLabel, actor.lastName, actor.firstName].filter(Boolean).join(" ");
  const today = new Date(`${isoToday()}T00:00:00Z`);
  const dow = today.getUTCDay() || 7;
  const dateText = new Intl.DateTimeFormat("ro-RO", { dateStyle: "full", timeZone: "UTC" }).format(today);

  // ───────── ADMINISTRATOR ─────────
  if (caps.administrare) {
    const d = await adminDashboard(actor);
    return (
      <>
        <PageHeader title={`Bun venit, ${name}`} subtitle={`${dateText} · an școlar activ: ${d.year?.name ?? "—"}`} />
        {d.failedLogins > 10 && (
          <div className="mb-6">
            <Alert tone="warning" title="Activitate neobișnuită">{d.failedLogins} încercări de autentificare eșuate sau blocate în ultimele 24 de ore. Verificați jurnalul de audit.</Alert>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Profesori activi" value={d.users.PROFESOR ?? 0} hint={`${d.users.ADMINISTRATOR ?? 0} administratori · ${d.users.COMANDANT_UNITATE ?? 0} comandant · ${d.inactiveUsers} inactivi`} icon={<Users className="h-5 w-5" />} />
          <Stat label="Clase active" value={d.classes} hint={d.classesWithoutHomeroom ? `${d.classesWithoutHomeroom} fără diriginte` : "toate au diriginte"} icon={<Layers className="h-5 w-5" />} />
          <Stat label="Elevi înmatriculați" value={d.students} icon={<GraduationCap className="h-5 w-5" />} />
          <Stat label="Repartizări active" value={d.assignments} hint={`${d.subjects} materii · ${d.openModules} module deschise`} icon={<Link2 className="h-5 w-5" />} />
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <QuickLink href="/administrare/utilizatori" label="Utilizatori" icon={Users} hint="Conturi, parole, stări" />
          <QuickLink href="/administrare/clase" label="Clase" icon={Layers} hint="Structura pe ani școlari" />
          <QuickLink href="/administrare/elevi" label="Elevi" icon={GraduationCap} hint="Înmatriculări și istoric" />
          <QuickLink href="/administrare/materii" label="Materii" icon={BookOpen} />
          <QuickLink href="/administrare/module" label="Module" icon={Grid3x3} hint="Planuri și stare" />
          <QuickLink href="/administrare/repartizari" label="Repartizări și diriginți" icon={Link2} />
          <QuickLink href="/administrare/orar" label="Orar" icon={Upload} hint={d.timetableVersion ? `Activ: ${d.timetableVersion}` : "Niciun orar publicat"} />
          <QuickLink href="/administrare/ani-scolari" label="Ani școlari" icon={Archive} hint={d.lastRollover ? `Ultima trecere: ${d.lastRollover.toYear}` : "Trecere automată la 1 septembrie"} />
          <QuickLink href="/administrare/configurare" label="Configurare" icon={Settings} hint="Setări, motive de notă, reguli de calcul" />
          <QuickLink href="/audit" label="Jurnal de audit" icon={ShieldCheck} hint="Auditul complet al sistemului" />
        </div>
      </>
    );
  }

  // ───────── COMANDANT UNITATE ─────────
  if (caps.catalogGeneral) {
    const d = await commanderDashboard(actor);
    return (
      <>
        <PageHeader title={`Bun venit, ${name}`} subtitle={`${dateText} · an școlar ${d.year?.name ?? "—"}`} />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {d.companies.map((c) => (
            <Stat key={c.name} label={`${c.name} (anul ${c.yearOfStudy === 1 ? "I" : "II"})`} value={c.students} hint={`elevi în ${plural(c.classes, "clasă", "clase")}`} icon={<Users className="h-5 w-5" />} />
          ))}
          <Stat label="Cereri de corecție în așteptare" value={d.pendingCorrections} icon={<Inbox className="h-5 w-5" />} />
          <Stat label="Note introduse (7 zile)" value={d.gradesLastWeek} hint={`${d.openModules} module deschise`} icon={<ClipboardList className="h-5 w-5" />} />
        </div>
        {d.pendingCorrections > 0 && (
          <div className="mt-6">
            <Alert tone="warning" title={`${plural(d.pendingCorrections, "cerere de corecție așteaptă", "cereri de corecție așteaptă")} soluționarea.`}>
              <Link href="/cereri-corectie" className="font-medium underline">Deschide cererile</Link>
            </Alert>
          </div>
        )}
        <div className="mt-6 grid gap-6 xl:grid-cols-3">
          <div className="grid gap-4 sm:grid-cols-2 xl:col-span-2">
            <QuickLink href="/catalog" label="Catalog – clase și elevi" icon={BookOpen} hint="Toate clasele, notele și rezultatele pe module" />
            <QuickLink href="/cereri-corectie" label="Cereri de corecție" icon={Inbox} hint="Aprobare sau respingere" />
            <QuickLink href="/rapoarte" label="Rapoarte" icon={FileText} hint="Situații, medii, rezultate, foi matricole" />
            <QuickLink href="/audit" label="Audit note" icon={ShieldCheck} hint="Modificări, ștergeri, aprobări" />
            <QuickLink href="/orar" label="Orar" icon={CalendarDays} />
            <QuickLink href="/catalog" label="Istoric academic" icon={Archive} hint="Selectați un an școlar anterior în catalog" />
          </div>
          <Card>
            <CardHeader title="Ultimele modificări de note" />
            {d.recent.length === 0 ? (
              <EmptyState title="Nicio modificare recentă." />
            ) : (
              <ul className="divide-y divide-border">
                {d.recent.map((r) => {
                  const snap = r.actorSnapshot as { firstName?: string; lastName?: string } | null;
                  return (
                    <li key={r.id} className="px-5 py-3 text-sm">
                      <p className="font-medium">{AUDIT_ACTION_LABEL[r.action]}</p>
                      <p className="text-xs text-muted">{snap ? `${snap.lastName} ${snap.firstName}` : ""} · {formatDateTime(r.occurredAt)}</p>
                      {r.reason && <p className="mt-0.5 text-xs">„{r.reason}”</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </>
    );
  }

  // ───────── ELEV (optional, only when student accounts are enabled) ─────────
  if (caps.noteleMele) {
    return (
      <>
        <PageHeader title={`Bun venit, ${name}`} subtitle={dateText} />
        <div className="grid gap-4 sm:grid-cols-2">
          <QuickLink href="/elev" label="Situația mea școlară" icon={GraduationCap} />
          <QuickLink href="/orar" label="Orarul clasei" icon={CalendarDays} />
        </div>
      </>
    );
  }

  // ───────── PROFESOR / DIRIGINTE ─────────
  const [classes, d, timetable] = await Promise.all([
    listMyClasses(actor),
    teacherDashboard(actor),
    getWeekTimetable(actor, { week: today }).catch(() => null),
  ]);
  const todayLessons = timetable?.entries.filter((e) => e.dayOfWeek === dow) ?? [];
  const subjects = new Map<string, string>();
  for (const c of classes) for (const s of c.subjects) subjects.set(s.id, s.name);

  return (
    <>
      <PageHeader title={`Bun venit, ${name}`} subtitle={dateText} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Clase" value={classes.length} icon={<Users className="h-5 w-5" />} />
        <Stat label="Materii" value={subjects.size} icon={<BookOpen className="h-5 w-5" />} />
        <Stat label="Elevi" value={d.students} icon={<GraduationCap className="h-5 w-5" />} />
        <Stat label="Cereri de corecție în așteptare" value={d.pendingRequests} icon={<Inbox className="h-5 w-5" />} />
      </div>

      {d.homeroom.map((h) => (
        <Card key={h.id} className="mt-6 border-accent/40">
          <CardHeader
            title={`Dirigenție – clasa ${h.code}`}
            description={`${plural(h.students, "elev", "elevi")}${h.openModule ? ` · ${h.openModule}: note la purtare ${h.conductEntered}/${h.students}` : ""}`}
            actions={<Badge tone="accent">Diriginte</Badge>}
          />
          <div className="flex flex-wrap gap-2 p-5">
            <ButtonLink href={`/catalog/clase/${h.id}`} variant="secondary">Situația clasei</ButtonLink>
            {h.openModule && h.conductEntered !== null && h.conductEntered < h.students && (
              <span className="inline-flex items-center gap-1.5 text-sm text-warning">
                <AlertTriangle className="h-4 w-4" /> Lipsesc note la purtare
              </span>
            )}
            <ButtonLink href={`/orar?clasa=${h.id}`} variant="secondary">Orarul clasei</ButtonLink>
            <ButtonLink href={`/rapoarte/rezultate-an?clasa=${h.id}`} variant="secondary">Rezultatele anului</ButtonLink>
          </div>
        </Card>
      ))}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={`Orele de astăzi – ${DAY_NAMES[dow]?.toLowerCase()}`} actions={<ButtonLink href="/orar" variant="ghost" size="sm">Orarul săptămânii</ButtonLink>} />
          {todayLessons.length === 0 ? (
            <EmptyState title="Nu aveți ore programate astăzi." />
          ) : (
            <ul className="divide-y divide-border">
              {todayLessons.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="flex items-center gap-4">
                    <span className="tabular w-24 text-sm font-semibold text-primary">{l.timeSlot.startTime}–{l.timeSlot.endTime}</span>
                    <div>
                      <p className="font-medium">{l.subject.name}</p>
                      <p className="text-sm text-muted">Clasa {l.classSection.code}{l.room ? ` · Sala ${l.room}` : ""}</p>
                    </div>
                  </div>
                  <ButtonLink href={`/catalog/clase/${l.classSection.id}/materii/${l.subject.id}`} variant="secondary" size="sm">Notare</ButtonLink>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Ultimele note introduse" actions={<ButtonLink href="/catalog/notele-mele" variant="ghost" size="sm">Toate</ButtonLink>} />
          {d.recentGrades.length === 0 ? (
            <EmptyState title="Nu ați introdus încă note." />
          ) : (
            <ul className="divide-y divide-border">
              {d.recentGrades.map((g) => (
                <li key={g.id}>
                  <Link href={`/catalog/note/${g.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2">
                    <span className="min-w-0 text-sm">
                      <span className="block truncate font-medium">{g.student.lastName} {g.student.firstName}</span>
                      <span className="block truncate text-xs text-muted">{g.subject.name} · {g.classSection.code}</span>
                    </span>
                    <GradePill value={g.value} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="xl:col-span-3">
          <CardHeader title="Clasele și materiile mele" description="Doar clasele și materiile la care sunteți repartizat" />
          {classes.length === 0 ? (
            <EmptyState title="Nu aveți repartizări active." icon={<ClipboardList className="h-6 w-6" />}>Repartizările sunt configurate de administrator.</EmptyState>
          ) : (
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
              {classes.map((c) => (
                <Link key={c.id} href={`/catalog/clase/${c.id}`} className="rounded-2xl">
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
      </div>
    </>
  );
}
