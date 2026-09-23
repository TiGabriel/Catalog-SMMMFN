import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, BookOpen, FileText, Layers } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { getPageContext, requireCap } from "@/server/http/page";
import { getClassOverview, listMyClasses } from "@/server/domain/catalog";
import { listAcademicYears } from "@/server/domain/academic";

export const metadata: Metadata = { title: "Rapoarte" };

/**
 * Report index built from what the actor can access. The links are only a
 * convenience – every report re-checks authorization on the server.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ an?: string }> }) {
  const sp = await searchParams;
  const { actor, caps } = await getPageContext();
  requireCap(caps.rapoarte);
  const years = caps.catalogGeneral ? await listAcademicYears(actor) : [];
  const year = years.find((y) => y.id === sp.an) ?? years.find((y) => y.status === "ACTIVE");
  const classes = await listMyClasses(actor, caps.catalogGeneral ? year?.id : undefined);
  const overviews = await Promise.all(classes.map((c) => getClassOverview(actor, c.id)));

  const link = (href: string, label: string) => (
    <Link href={href} className="rounded-lg border border-border px-2.5 py-1 text-sm transition-colors hover:border-primary/40 hover:bg-surface-2">
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Rapoarte"
        subtitle="Rapoarte tabelare, exportabile în Excel și pregătite pentru tipărire (sau salvare ca PDF din fereastra de tipărire)."
      />
      {caps.catalogGeneral && (
        <>
          {years.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {years.map((y) => (
                <Link key={y.id} href={`?an=${y.id}`} className={`rounded-full border px-3 py-1 text-sm ${y.id === year?.id ? "border-primary bg-primary text-primary-contrast" : "border-border hover:bg-surface-2"}`}>
                  {y.name}
                </Link>
              ))}
            </div>
          )}
          <Card className="mb-6">
            <CardHeader title="Situația generală a școlii" description="Pe companii și clase: elevi, note înregistrate, media clasei, elevi cu medii sub 5" actions={<BarChart3 className="h-5 w-5 text-primary" />} />
            <div className="p-5">{link(`/rapoarte/situatie-generala${year ? `?an=${year.id}` : ""}`, "Deschide raportul")}</div>
          </Card>
        </>
      )}
      {overviews.length === 0 ? (
        <Card>
          <EmptyState title="Nu aveți clase pentru care să generați rapoarte." />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {overviews.map((o) => {
            const full = o.canSeeResults;
            return (
              <Card key={o.class.id}>
                <CardHeader
                  title={`Clasa ${o.class.code}`}
                  description={`${o.class.company} · ${o.class.academicYear.name}`}
                  actions={o.isHomeroom ? <Badge tone="accent">Diriginte</Badge> : !full ? <Badge>Materiile proprii</Badge> : undefined}
                />
                <div className="flex flex-col gap-3 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <BookOpen className="h-4 w-4 text-muted" />
                    {link(`/rapoarte/catalog-clasa?clasa=${o.class.id}`, "Catalogul clasei")}
                    {link(`/rapoarte/medii-clasa?clasa=${o.class.id}`, "Medii pe materii")}
                    {full && link(`/rapoarte/rezultate-an?clasa=${o.class.id}`, "Rezultatele anului")}
                  </div>
                  {full && o.modules.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Layers className="h-4 w-4 text-muted" />
                      {o.modules.map((m) => link(`/rapoarte/rezultate-modul?clasa=${o.class.id}&modul=${m.id}`, `Rezultate ${m.name}`))}
                    </div>
                  )}
                  <div className="flex items-start gap-2 text-sm text-muted">
                    <FileText className="mt-0.5 h-4 w-4" />
                    <span>Situația fiecărui elev{caps.catalogGeneral ? " și foaia matricolă" : ""} se generează din pagina elevului.</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
