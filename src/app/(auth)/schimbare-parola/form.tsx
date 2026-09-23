"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { api } from "@/lib/api-client";
import { PASSWORD_POLICY_TEXT, passwordPolicyErrors } from "@/lib/validation/password";

export function ChangePasswordForm({ mandatory }: { mandatory: boolean }) {
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const currentPassword = String(f.get("currentPassword") ?? "");
    const newPassword = String(f.get("newPassword") ?? "");
    const confirm = String(f.get("confirm") ?? "");
    const local: Record<string, string[]> = {};
    const policy = passwordPolicyErrors(newPassword);
    if (policy.length) local.newPassword = policy;
    if (newPassword !== confirm) local.confirm = ["Parolele nu coincid."];
    setErrors(local);
    setMessage(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    const res = await api("POST", "/api/auth/change-password", { currentPassword, newPassword });
    setBusy(false);
    if (res.ok) {
      setDone(true);
      return;
    }
    setErrors(res.error.details ?? {});
    if (!res.error.details) setMessage(res.error.message);
  }

  if (done) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <Alert tone="success" title="Parola a fost schimbată.">
          Celelalte sesiuni deschise au fost închise automat.
        </Alert>
        <Link href="/panou" className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-contrast hover:bg-primary-hover">
          Continuă
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
      {message && <Alert tone="danger">{message}</Alert>}
      <Field label="Parola actuală" htmlFor="currentPassword" error={errors.currentPassword}>
        <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" className={inputClass} required />
      </Field>
      <Field label="Parola nouă" htmlFor="newPassword" error={errors.newPassword} hint={PASSWORD_POLICY_TEXT}>
        <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" className={inputClass} required maxLength={128} />
      </Field>
      <Field label="Confirmați parola nouă" htmlFor="confirm" error={errors.confirm}>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" className={inputClass} required maxLength={128} />
      </Field>
      <Button type="submit" disabled={busy} size="lg">
        {busy ? "Se salvează…" : "Salvează parola"}
      </Button>
      {!mandatory && (
        <Link href="/panou" className="text-center text-sm text-muted hover:text-text">
          Renunță
        </Link>
      )}
    </form>
  );
}
