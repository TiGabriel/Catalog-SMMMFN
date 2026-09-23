"use client";

import { useRouter } from "next/navigation";
import { Button, Field, inputClass } from "@/components/ui";

type Opt = { value: string; label: string };

export function AuditFilters({
  values,
  actions,
  users,
  years,
  classes,
  subjects,
  students,
}: {
  values: Record<string, string>;
  actions: Opt[];
  users: Opt[];
  years: Opt[];
  classes: Opt[];
  subjects: Opt[];
  students: Opt[];
}) {
  const router = useRouter();
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const p = new URLSearchParams();
    for (const [k, v] of f.entries()) if (typeof v === "string" && v) p.set(k, v);
    router.push(`?${p.toString()}`);
  }
  const select = (name: string, label: string, opts: Opt[], onChangeSubmit = false) => (
    <Field label={label} htmlFor={`a-${name}`}>
      <select
        id={`a-${name}`}
        name={name}
        defaultValue={values[name] ?? ""}
        className={inputClass}
        onChange={onChangeSubmit ? (e) => e.currentTarget.form?.requestSubmit() : undefined}
      >
        <option value="">Toate</option>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
  return (
    <form onSubmit={submit} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
      <Field label="De la" htmlFor="a-from">
        <input id="a-from" name="from" type="date" defaultValue={values.from ?? ""} className={inputClass} />
      </Field>
      <Field label="Până la" htmlFor="a-to">
        <input id="a-to" name="to" type="date" defaultValue={values.to ?? ""} className={inputClass} />
      </Field>
      {select("action", "Acțiune", actions)}
      {select("actorId", "Utilizator", users)}
      {select("academicYearId", "An școlar", years, true)}
      {select("classSectionId", "Clasa", classes, true)}
      {select("studentId", "Elev", students)}
      {select("subjectId", "Materie", subjects)}
      <div className="flex items-end gap-2">
        <Button type="submit">Filtrează</Button>
        <Button variant="ghost" onClick={() => router.push("?")}>Resetează</Button>
      </div>
    </form>
  );
}
