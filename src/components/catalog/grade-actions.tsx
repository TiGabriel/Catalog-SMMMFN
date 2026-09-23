"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Send, Trash2 } from "lucide-react";
import { Alert, Button, Card, CardHeader, Field, inputClass } from "@/components/ui";
import { api, firstErrors } from "@/lib/api-client";

type Grade = { id: string; value: number; version: number; reasonId: string | null; gradeDate: string; note: string | null };
type Mode = "none" | "modify" | "delete" | "request";

export function GradeActions({
  grade,
  canModify,
  canRequest,
  pendingRequest,
  reasons,
  today,
}: {
  grade: Grade;
  canModify: boolean;
  canRequest: boolean;
  pendingRequest: boolean;
  reasons: { id: string; label: string }[];
  today: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("none");
  const [errors, setErrors] = useState<string[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => Number(String(f.get(k) ?? "").replace(",", "."));
    setBusy(true);
    setErrors([]);
    let res;
    if (mode === "modify") {
      res = await api("PATCH", `/api/grades/${grade.id}`, {
        value: num("value"),
        reasonId: String(f.get("reasonId")) || undefined,
        gradeDate: String(f.get("gradeDate")),
        note: String(f.get("note") ?? "") || null,
        changeReason: String(f.get("changeReason") ?? ""),
        version: grade.version,
      });
    } else if (mode === "delete") {
      res = await api("POST", `/api/grades/${grade.id}/delete`, { reason: String(f.get("reason") ?? ""), version: grade.version });
    } else {
      const type = String(f.get("type"));
      res = await api("POST", "/api/corrections", {
        gradeId: grade.id,
        type,
        proposedValue: type === "MODIFY" ? num("proposedValue") : undefined,
        justification: String(f.get("justification") ?? ""),
      });
    }
    setBusy(false);
    if (!res.ok) {
      setErrors(firstErrors(res.error));
      return;
    }
    setInfo(mode === "request" ? "Cererea a fost trimisă comandantului spre aprobare." : "Modificarea a fost salvată.");
    setMode("none");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader
        title="Acțiuni"
        description={
          canModify
            ? "Puteți modifica sau șterge nota introdusă de dumneavoastră. Motivul este obligatoriu și este înregistrat în audit."
            : "Modificarea directă nu mai este posibilă. Puteți trimite o cerere specială de corecție către comandant."
        }
        actions={
          <>
            {canModify && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setMode("modify")}>
                  <Pencil className="h-4 w-4" /> Modifică
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setMode("delete")} className="hover:!border-danger/50 hover:!text-danger">
                  <Trash2 className="h-4 w-4" /> Șterge
                </Button>
              </>
            )}
            {!canModify && canRequest && (
              <Button variant="secondary" size="sm" onClick={() => setMode("request")}>
                <Send className="h-4 w-4" /> Cerere de corecție
              </Button>
            )}
          </>
        }
      />
      <div className="p-5">
        {info && <Alert tone="success">{info}</Alert>}
        {pendingRequest && mode === "none" && !info && <Alert tone="warning">Există o cerere de corecție în așteptare pentru această notă.</Alert>}
        {mode !== "none" && (
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
            {mode === "modify" && (
              <>
                <Field label="Nota nouă (1–10)" htmlFor="value">
                  <input id="value" name="value" defaultValue={grade.value} inputMode="numeric" className={`${inputClass} tabular`} required />
                </Field>
                <Field label="Data notei" htmlFor="gradeDate">
                  <input id="gradeDate" name="gradeDate" type="date" defaultValue={grade.gradeDate} max={today} className={inputClass} />
                </Field>
                <Field label="Tip evaluare" htmlFor="reasonId">
                  <select id="reasonId" name="reasonId" defaultValue={grade.reasonId ?? ""} className={inputClass}>
                    {reasons.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Observații" htmlFor="note">
                  <input id="note" name="note" defaultValue={grade.note ?? ""} maxLength={300} className={inputClass} />
                </Field>
                <Field label="Motivul modificării (obligatoriu)" htmlFor="changeReason" className="sm:col-span-2">
                  <textarea id="changeReason" name="changeReason" required minLength={3} maxLength={500} rows={2} className={`${inputClass} h-auto py-2`} />
                </Field>
              </>
            )}
            {mode === "delete" && (
              <Field label="Motivul ștergerii (obligatoriu)" htmlFor="reason" className="sm:col-span-2" hint="Nota nu este eliminată fizic: rămâne în istoric marcată ca ștearsă.">
                <textarea id="reason" name="reason" required minLength={3} maxLength={500} rows={2} className={`${inputClass} h-auto py-2`} />
              </Field>
            )}
            {mode === "request" && (
              <>
                <Field label="Tip cerere" htmlFor="type">
                  <select id="type" name="type" className={inputClass}>
                    <option value="MODIFY">Corectarea notei</option>
                    <option value="DELETE">Ștergerea notei</option>
                  </select>
                </Field>
                <Field label="Nota propusă (pentru corectare)" htmlFor="proposedValue">
                  <input id="proposedValue" name="proposedValue" inputMode="numeric" className={`${inputClass} tabular`} />
                </Field>
                <Field label="Justificare (obligatorie)" htmlFor="justification" className="sm:col-span-2">
                  <textarea id="justification" name="justification" required minLength={3} maxLength={500} rows={3} className={`${inputClass} h-auto py-2`} />
                </Field>
              </>
            )}
            {errors.length > 0 && (
              <div className="sm:col-span-2">
                <Alert tone="danger">
                  <ul className="list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </Alert>
              </div>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" variant={mode === "delete" ? "danger" : "primary"} disabled={busy}>
                {busy ? "Se trimite…" : mode === "delete" ? "Confirmă ștergerea" : mode === "request" ? "Trimite cererea" : "Salvează modificarea"}
              </Button>
              <Button variant="ghost" onClick={() => { setMode("none"); setErrors([]); }}>Renunță</Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
