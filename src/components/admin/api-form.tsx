"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { api, type ApiError } from "@/lib/api-client";
import { cn } from "@/lib/cn";

export type FieldDef =
  | { name: string; label: string; type: "text" | "date" | "password"; required?: boolean; placeholder?: string; hint?: string; defaultValue?: string; span?: number }
  | { name: string; label: string; type: "number"; required?: boolean; min?: number; max?: number; step?: number; defaultValue?: number; hint?: string; span?: number }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[]; required?: boolean; defaultValue?: string; hint?: string; span?: number; emptyLabel?: string; numeric?: boolean }
  | { name: string; label: string; type: "checkbox"; defaultValue?: boolean; hint?: string; span?: number };

const SPAN: Record<number, string> = { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4" };

/**
 * Generic JSON form for administration pages. Values are sent as typed JSON;
 * empty optional fields are omitted. The server validates everything again.
 */
export function ApiForm({
  fields,
  method = "POST",
  action,
  submitLabel,
  successMessage,
  extra,
  columns = 3,
  onSuccessReset = true,
}: {
  fields: FieldDef[];
  method?: "POST" | "PATCH" | "PUT";
  action: string;
  submitLabel: string;
  successMessage?: string;
  extra?: Record<string, unknown>;
  columns?: 2 | 3 | 4;
  onSuccessReset?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body: Record<string, unknown> = { ...extra };
    for (const def of fields) {
      if (def.type === "checkbox") {
        body[def.name] = f.get(def.name) === "on";
        continue;
      }
      const raw = String(f.get(def.name) ?? "").trim();
      if (raw === "") continue;
      body[def.name] = def.type === "number" || (def.type === "select" && def.numeric) ? Number(raw.replace(",", ".")) : raw;
    }
    setBusy(true);
    setError(null);
    setOk(false);
    const res = await api(method, action, body);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOk(true);
    if (onSuccessReset) form.reset();
    router.refresh();
  }

  const grid = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[columns];
  return (
    <form onSubmit={submit} className={cn("grid gap-4 p-5", grid)} noValidate>
      {fields.map((def) => {
        const err = error?.details?.[def.name];
        const span = def.span ? SPAN[def.span] ?? "" : "";
        if (def.type === "checkbox") {
          return (
            <label key={def.name} className={cn("flex items-center gap-2 self-end pb-2 text-sm", span)}>
              <input type="checkbox" name={def.name} defaultChecked={def.defaultValue} className="h-4 w-4 accent-[var(--primary)]" />
              {def.label}
            </label>
          );
        }
        return (
          <Field key={def.name} label={def.label} htmlFor={`f-${action}-${def.name}`} error={err} hint={def.hint} className={span}>
            {def.type === "select" ? (
              <select id={`f-${action}-${def.name}`} name={def.name} defaultValue={def.defaultValue ?? ""} className={inputClass}>
                {!def.required && <option value="">{def.emptyLabel ?? "—"}</option>}
                {def.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`f-${action}-${def.name}`}
                name={def.name}
                type={def.type === "number" ? "text" : def.type}
                inputMode={def.type === "number" ? "decimal" : undefined}
                defaultValue={def.defaultValue as string | number | undefined}
                placeholder={"placeholder" in def ? def.placeholder : undefined}
                className={inputClass}
                autoComplete={def.type === "password" ? "new-password" : "off"}
              />
            )}
          </Field>
        );
      })}
      <div className="flex items-end">
        <Button type="submit" disabled={busy} className="w-full sm:w-auto">
          {busy ? "Se salvează…" : submitLabel}
        </Button>
      </div>
      {(error || ok) && (
        <div className={cn("sm:col-span-2", columns >= 3 && "lg:col-span-3", columns === 4 && "lg:col-span-4")}>
          {error && <Alert tone="danger">{error.details ? "Verificați câmpurile marcate." : error.message}</Alert>}
          {ok && <Alert tone="success">{successMessage ?? "Salvat."}</Alert>}
        </div>
      )}
    </form>
  );
}

/** Button for a single API action, with confirmation and optional mandatory reason. */
export function ActionButton({
  method = "POST",
  action,
  label,
  confirmText,
  reasonPrompt,
  body,
  variant = "secondary",
}: {
  method?: "POST" | "PATCH" | "DELETE" | "PUT";
  action: string;
  label: string;
  confirmText?: string;
  reasonPrompt?: string;
  body?: Record<string, unknown>;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    let payload = body;
    if (reasonPrompt) {
      const reason = window.prompt(reasonPrompt);
      if (!reason || reason.trim().length < 3) return;
      payload = { ...body, reason: reason.trim() };
    } else if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    const res = await api(method, action, payload);
    setBusy(false);
    if (!res.ok) window.alert(res.error.details ? Object.values(res.error.details).flat().join("\n") : res.error.message);
    else router.refresh();
  }
  return (
    <Button size="sm" variant={variant} onClick={run} disabled={busy}>
      {label}
    </Button>
  );
}
