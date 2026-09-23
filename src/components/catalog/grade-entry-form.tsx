"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { api, firstErrors } from "@/lib/api-client";
import { GRADE_KIND_LABEL } from "@/lib/format";

type Props = {
  classSectionId: string;
  subjectId: string;
  students: { id: string; name: string }[];
  modules: { id: string; name: string; kinds: string[] }[];
  reasons: { id: string; label: string; appliesTo: string[] }[];
  today: string;
};

export function GradeEntryForm({ classSectionId, subjectId, students, modules, reasons, today }: Props) {
  const router = useRouter();
  const [moduleId, setModuleId] = useState(modules[0]?.id ?? "");
  const kinds = useMemo(() => modules.find((m) => m.id === moduleId)?.kinds ?? [], [modules, moduleId]);
  const [kind, setKind] = useState(kinds[0] ?? "CURRENT");
  const effectiveKind = kinds.includes(kind) ? kind : (kinds[0] ?? "CURRENT");
  const kindReasons = reasons.filter((r) => r.appliesTo.includes(effectiveKind));
  const [errors, setErrors] = useState<string[]>([]);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const value = Number(String(f.get("value") ?? "").replace(",", "."));
    setBusy(true);
    setErrors([]);
    setOk(null);
    const res = await api("POST", "/api/grades", {
      studentId: String(f.get("studentId")),
      classSectionId,
      subjectId,
      moduleId,
      kind: effectiveKind,
      value,
      reasonId: String(f.get("reasonId")),
      gradeDate: String(f.get("gradeDate")),
      note: String(f.get("note") ?? "") || undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setErrors(firstErrors(res.error));
      return;
    }
    const student = students.find((s) => s.id === f.get("studentId"))?.name;
    setOk(`Nota ${value} a fost înregistrată pentru ${student}.`);
    (form.elements.namedItem("value") as HTMLInputElement).value = "";
    router.refresh();
  }

  if (students.length === 0) return null;
  return (
    <form onSubmit={onSubmit} className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-6" noValidate>
      <Field label="Elev" htmlFor="studentId" className="lg:col-span-2">
        <select id="studentId" name="studentId" className={inputClass} required>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Modul" htmlFor="moduleId">
        <select id="moduleId" value={moduleId} onChange={(e) => setModuleId(e.target.value)} className={inputClass}>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Tip notă" htmlFor="kind">
        <select id="kind" value={effectiveKind} onChange={(e) => setKind(e.target.value)} className={inputClass} disabled={kinds.length < 2}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {GRADE_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Nota (1–10)" htmlFor="value">
        <input id="value" name="value" inputMode="numeric" pattern="[0-9]*" required className={`${inputClass} tabular`} placeholder="ex. 9" />
      </Field>
      <Field label="Data" htmlFor="gradeDate">
        <input id="gradeDate" name="gradeDate" type="date" defaultValue={today} max={today} required className={inputClass} />
      </Field>
      <Field label="Motiv / tip evaluare" htmlFor="reasonId" className="lg:col-span-2">
        <select id="reasonId" name="reasonId" className={inputClass} required>
          {kindReasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Observații (opțional)" htmlFor="note" className="lg:col-span-3">
        <input id="note" name="note" maxLength={300} className={inputClass} />
      </Field>
      <div className="flex items-end">
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Se salvează…" : "Adaugă nota"}
        </Button>
      </div>
      {(errors.length > 0 || ok) && (
        <div className="sm:col-span-2 lg:col-span-6">
          {errors.length > 0 && (
            <Alert tone="danger">
              <ul className="list-disc pl-4">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </Alert>
          )}
          {ok && <Alert tone="success">{ok}</Alert>}
        </div>
      )}
    </form>
  );
}
