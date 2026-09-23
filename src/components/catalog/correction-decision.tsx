"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button, inputClass } from "@/components/ui";
import { api, firstErrors } from "@/lib/api-client";

export function CorrectionDecision({ id, mode }: { id: string; mode: "review" | "cancel" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function act(decision?: "APPROVE" | "REJECT") {
    if (decision && !confirm(decision === "APPROVE" ? "Aprobați cererea? Modificarea va fi aplicată notei." : "Respingeți cererea?")) return;
    if (!decision && !confirm("Anulați cererea?")) return;
    setBusy(true);
    setError(null);
    const res = decision
      ? await api("POST", `/api/corrections/${id}/review`, { decision, comment: comment || undefined })
      : await api("POST", `/api/corrections/${id}/cancel`);
    setBusy(false);
    if (!res.ok) setError(firstErrors(res.error).join(" "));
    else router.refresh();
  }

  if (mode === "cancel") {
    return (
      <Button size="sm" variant="ghost" onClick={() => act()} disabled={busy}>
        Anulează
      </Button>
    );
  }
  return (
    <div className="flex min-w-48 flex-col gap-2">
      <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} placeholder="Comentariu (opțional)" className={`${inputClass} h-8 text-xs`} aria-label="Comentariu" />
      <div className="flex gap-1.5">
        <Button size="sm" onClick={() => act("APPROVE")} disabled={busy}>
          <Check className="h-4 w-4" /> Aprobă
        </Button>
        <Button size="sm" variant="secondary" onClick={() => act("REJECT")} disabled={busy}>
          <X className="h-4 w-4" /> Respinge
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
