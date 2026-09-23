import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getPageContext, load, requireCap } from "@/server/http/page";
import { listMyClasses } from "@/server/domain/catalog";
import { listAcademicYears } from "@/server/domain/academic";

export const metadata: Metadata = { title: "Catalog" };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ an?: string }> }) {
  const sp = await searchParams;
  const { actor, caps } = await getPageContext();
  requireCap(caps.claseleMele || caps.catalogGeneral);
  // Academic history (previous years) is available to the commander.
  const years = caps.catalogGeneral ? await load(listAcademicYears(actor)) : [];
  const year = years.find((y) => y.id === sp.an) ?? years.find((y) => y.status === "ACTIVE");
  const classes = await load(listMyClasses(actor, caps.catalogGeneral ? year?.id : undefined));
  const groups = [2, 1].map((y) => ({ year: y, classes: classes.filter((c) => c.yearOfStudy === y) })).filter((g) => g.classes.length);

  return (
    <>
      <PageHeader
        title={caps.catalogGeneral ? "Catalog" : "Clasele mele"}
        subtitle={caps.catalogGeneral ? `Toate clasele – an școlar ${year?.name ?? ""}${year?.status === "CLOSED" ? " (istoric)" : ""}` : "Clasele la care aveți repartizări active"}
      />
      {years.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {years.map((y) => (
            <Link key={y.id} href={`?an=${y.id}`} className={`rounded-full border px-3 py-1 text-sm ${y.id === year?.id ? "border-primary bg-primary text-primary-contrast" : "border-border hover:bg-surface-2"}`}>
              {y.name}
            </Link>
          ))}
        </div>
      )}
      {groups.length === 0 ? (
        <Card>
          <EmptyState title="Nu există clase de afișat.">Repartizările sunt configurate de administrator.</EmptyState>
        </Card>
      ) : (
        groups.map((g) => (
          <section key={g.year} className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
              {g.classes[0]!.company} · Anul {g.year === 1 ? "I" : "II"}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {g.classes.map((c) => (
                <Link key={c.id} href={`/catalog/clase/${c.id}`} className="rounded-2xl">
                  <Card interactive className="h-full p-5">
                    <div className="flex items-start justify-between">
                      <p className="text-2xl font-bold tracking-tight">{c.code}</p>
                      {c.isHomeroom && <Badge tone="accent">Diriginte</Badge>}
                    </div>
                    {c.subjects.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {c.subjects.map((s) => (
                          <Badge key={s.id} tone="primary">{s.name}</Badge>
                        ))}
                      </div>
                    )}
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
