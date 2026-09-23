"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api-client";

export function VerifyChainButton() {
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function verify() {
    setBusy(true);
    const res = await api<{ checked: number; intact: boolean; firstInvalidId: string | null }>("GET", "/api/audit/verify");
    setBusy(false);
    if (!res.ok) setState(res.error.message);
    else setState(res.data.intact ? `Integritate confirmată (${res.data.checked} înregistrări).` : `ATENȚIE: lanțul este întrerupt la înregistrarea #${res.data.firstInvalidId}.`);
  }
  return (
    <div className="flex items-center gap-3">
      {state && <span className="text-sm text-muted">{state}</span>}
      <Button variant="secondary" onClick={verify} disabled={busy}>
        <ShieldCheck className="h-4 w-4" /> {busy ? "Se verifică…" : "Verifică integritatea"}
      </Button>
    </div>
  );
}
