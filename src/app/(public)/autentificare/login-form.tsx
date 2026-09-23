"use client";

import { useState } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { api } from "@/lib/api-client";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await api<{ mustChangePassword: boolean }>("POST", "/api/auth/login", {
      username: String(form.get("username") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (res.ok) {
      // Full navigation so every server component renders with the new session.
      window.location.assign(new URL(res.data.mustChangePassword ? "/schimbare-parola" : "/panou", window.location.origin));
      return;
    }
    setError(res.error.message);
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Nume de utilizator" htmlFor="username">
        <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={64} className={inputClass} autoFocus />
      </Field>
      <Field label="Parolă" htmlFor="password">
        <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} className={inputClass} />
      </Field>
      <Button type="submit" size="lg" disabled={busy} className="mt-2 w-full">
        {busy ? "Se verifică…" : "Intră în cont"}
      </Button>
      <p className="text-center text-xs text-muted">Ați uitat parola? Contactați administratorul sistemului.</p>
    </form>
  );
}
