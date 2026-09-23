import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-6">
      <div className="text-center">
        <p className="text-sm font-semibold text-primary">404</p>
        <h1 className="mt-2 text-2xl font-bold">Pagina nu a fost găsită</h1>
        <p className="mt-2 text-muted">Resursa nu există sau nu aveți acces la ea.</p>
        <Link href="/panou" className="mt-6 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-contrast hover:bg-primary-hover">
          Înapoi la panou
        </Link>
      </div>
    </div>
  );
}
