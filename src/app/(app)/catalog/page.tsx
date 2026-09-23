import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getPageContext, load, requireCap } from "@/server/http/page";
import { listMyClasses } from "@/server/domain/catalog";

export const metadata: Metadata = { title: "Catalog" };

export default async function CatalogPage() {
  const { actor, caps } = await getPageContext();
  requireCap(caps.claseleMele || caps.catalogGeneral);
  const classes = await load(listMyClasses(actor));
  const groups = [2, 1].map((y) => ({ year: y, classes: classes.filter((c) => c.yearOfStudy === y) })).filter((g) => g.classes.length);

  return (
    <>
      <PageHeader
        title={caps.catalogGeneral ? "Catalog" : "Clasele mele"}
        subtitle={caps.catalogGeneral ? "Toate clasele din anul școlar activ" : "Clasele la care aveți repartizări active"}
      />
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
