"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { api } from "@/lib/api-client";

/** Creates a new (draft) version of the averaging rules from a JSON definition. */
export function RuleSetEditor({ initial }: { initial: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    setOk(false);
    let definition: unknown;
    try {
      definition = JSON.parse(String(f.get("definition") ?? ""));
    } catch {
      setError("Definiția nu este un JSON valid.");
      return;
    }
    const res = await api("POST", "/api/admin/rule-sets", { name: String(f.get("name") ?? ""), definition });
    if (!res.ok) setError(res.error.details ? Object.values(res.error.details).flat().join(" ") : res.error.message);
    else {
      setOk(true);
      router.refresh();
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-4 border-t border-border p-5 lg:grid-cols-3">
      <div className="flex flex-col gap-3">
        <Field label="Denumirea setului" htmlFor="rs-name" hint="Aceeași denumire creează o versiune nouă.">
          <input id="rs-name" name="name" required defaultValue="Reguli oficiale" className={inputClass} />
        </Field>
        <p className="text-xs text-muted">
          Parametri: rotunjire (zecimale, HALF_UP/TRUNCATE), media pe materie (MEAN_CURRENT / WEIGHTED_WITH_EXAM, ponderea examenului, minimul de note), purtarea (LAST/MEAN, inclusă sau nu), instruirea practică (inclusă sau nu), media modulului (MEAN_OF_FINALS / WEIGHTED_BY_MODULE_SUBJECT), media anuală.
        </p>
        <Button type="submit">Salvează ca versiune în lucru</Button>
        {error && <Alert tone="danger">{error}</Alert>}
        {ok && <Alert tone="success">Versiunea a fost creată; activați-o din tabelul de mai sus.</Alert>}
      </div>
      <Field label="Definiție (JSON)" htmlFor="rs-def" className="lg:col-span-2">
        <textarea id="rs-def" name="definition" defaultValue={initial} rows={16} spellCheck={false} className={`${inputClass} h-auto py-2 text-xs leading-relaxed`} />
      </Field>
    </form>
  );
}
