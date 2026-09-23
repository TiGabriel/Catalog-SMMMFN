"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, inputClass } from "@/components/ui";
import { api } from "@/lib/api-client";

type Value = boolean | number | string | string[];

const OPTIONS: Record<string, { value: string; label: string }[]> = {
  "rollover.mode": [
    { value: "AUTO", label: "Automat la 1 septembrie" },
    { value: "MANUAL_CONFIRM", label: "Cu confirmarea administratorului" },
  ],
};

export function SettingEditor({ settingKey, value }: { settingKey: string; value: Value }) {
  const router = useRouter();
  const [v, setV] = useState<Value>(value);
  const [msg, setMsg] = useState<string | null>(null);
  async function save(next: Value) {
    setMsg(null);
    const res = await api("PUT", `/api/admin/settings/${encodeURIComponent(settingKey)}`, { value: next });
    if (!res.ok) setMsg(res.error.details ? Object.values(res.error.details).flat().join(" ") : res.error.message);
    else {
      setMsg("Salvat");
      router.refresh();
    }
  }
  let control: React.ReactNode;
  if (typeof value === "boolean") {
    control = (
      <button
        type="button"
        role="switch"
        aria-checked={v as boolean}
        onClick={() => { const n = !(v as boolean); setV(n); void save(n); }}
        className={`relative h-6 w-11 rounded-full transition-colors ${v ? "bg-primary" : "bg-border"}`}
      >
        <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${v ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    );
  } else if (OPTIONS[settingKey]) {
    control = (
      <select className={`${inputClass} w-auto`} value={v as string} onChange={(e) => { setV(e.target.value); void save(e.target.value); }}>
        {OPTIONS[settingKey]!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  } else {
    const text = Array.isArray(v) ? v.join(", ") : String(v);
    control = (
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const raw = String(new FormData(e.currentTarget).get("v") ?? "");
          const next: Value = typeof value === "number" ? Number(raw) : Array.isArray(value) ? raw.split(",").map((x) => x.trim()).filter(Boolean) : raw;
          void save(next);
        }}
      >
        <input name="v" defaultValue={text} className={`${inputClass} w-48`} />
        <Button type="submit" size="sm" variant="secondary">Salvează</Button>
      </form>
    );
  }
  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-xs text-muted">{msg}</span>}
      {control}
    </div>
  );
}
