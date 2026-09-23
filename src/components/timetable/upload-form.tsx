"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Alert, Button, Field, inputClass } from "@/components/ui";

type Issue = { row: number | null; column: string | null; message: string };
type Result = { ok: boolean; versionId: string | null; report: { rowsRead: number; lessons: number; errors: Issue[]; warnings: Issue[] } };

export function TimetableUploadForm({ years, defaultYearId, today }: { years: { id: string; name: string }[]; defaultYearId: string; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/admin/timetable/imports", { method: "POST", body: new FormData(e.currentTarget), credentials: "same-origin" });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(json?.error?.details ? Object.values(json.error.details as Record<string, string[]>).flat().join(" ") : (json?.error?.message ?? "Încărcarea a eșuat."));
      return;
    }
    setResult(json);
    router.refresh();
  }

  return (
    <div className="p-5">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" encType="multipart/form-data">
        <Field label="An școlar" htmlFor="academicYearId">
          <select id="academicYearId" name="academicYearId" defaultValue={defaultYearId} className={inputClass}>
            {years.map((y) => (
              <option key={y.id} value={y.id}>{y.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Valabil din săptămâna" htmlFor="validFrom" hint="Se aplică de luni">
          <input id="validFrom" name="validFrom" type="date" required defaultValue={today} className={inputClass} />
        </Field>
        <Field label="Până în săptămâna (opțional)" htmlFor="validTo">
          <input id="validTo" name="validTo" type="date" className={inputClass} />
        </Field>
        <Field label="Denumire" htmlFor="name">
          <input id="name" name="name" required maxLength={80} placeholder="ex. Orar semestrul I" className={inputClass} />
        </Field>
        <Field label="Fișier Excel (.xlsx)" htmlFor="file">
          <input id="file" name="file" type="file" required accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-sm" />
        </Field>
        <div className="sm:col-span-2 lg:col-span-5">
          <Button type="submit" disabled={busy}>
            <Upload className="h-4 w-4" /> {busy ? "Se validează…" : "Încarcă și validează"}
          </Button>
        </div>
      </form>
      {error && <div className="mt-4"><Alert tone="danger">{error}</Alert></div>}
      {result && (
        <div className="mt-4 flex flex-col gap-3">
          {result.ok ? (
            <Alert tone="success" title={`Fișier valid: ${result.report.lessons} ore citite.`}>
              A fost creată o versiune în lucru (nepublicată).{" "}
              <Link href={`/administrare/orar/${result.versionId}`} className="font-medium underline">
                Previzualizați și publicați
              </Link>
            </Alert>
          ) : (
            <Alert tone="danger" title={`Fișierul conține ${result.report.errors.length} erori – nimic nu a fost importat.`}>
              Corectați rândurile de mai jos și încărcați din nou.
            </Alert>
          )}
          {[...result.report.errors.map((i) => ({ ...i, t: "Eroare" })), ...result.report.warnings.map((i) => ({ ...i, t: "Avertisment" }))].length > 0 && (
            <div className="max-h-80 overflow-auto rounded-xl border border-border">
              <table className="data-table">
                <thead>
                  <tr><th>Tip</th><th>Rând</th><th>Coloană</th><th>Problemă</th></tr>
                </thead>
                <tbody>
                  {result.report.errors.map((i, k) => (
                    <tr key={`e${k}`}><td className="text-danger">Eroare</td><td className="tabular">{i.row ?? "—"}</td><td>{i.column ?? "—"}</td><td>{i.message}</td></tr>
                  ))}
                  {result.report.warnings.map((i, k) => (
                    <tr key={`w${k}`}><td className="text-warning">Avertisment</td><td className="tabular">{i.row ?? "—"}</td><td>{i.column ?? "—"}</td><td>{i.message}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
