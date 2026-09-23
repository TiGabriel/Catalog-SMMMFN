"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui";

function shift(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Week selection: previous / current / next week and a calendar date picker. */
export function WeekNav({ weekStart, weekEnd, currentWeekStart }: { weekStart: string; weekEnd: string; currentWeekStart: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const go = (iso: string) => {
    const p = new URLSearchParams(params.toString());
    p.set("saptamana", iso);
    router.push(`?${p.toString()}`);
  };
  const fmt = (iso: string) => iso.split("-").reverse().join(".");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => go(shift(weekStart, -7))} aria-label="Săptămâna anterioară">
        <ChevronLeft className="h-4 w-4" /> Anterioară
      </Button>
      <Button variant={weekStart === currentWeekStart ? "primary" : "secondary"} size="sm" onClick={() => go(currentWeekStart)}>
        <CalendarDays className="h-4 w-4" /> Săptămâna curentă
      </Button>
      <Button variant="secondary" size="sm" onClick={() => go(shift(weekStart, 7))} aria-label="Săptămâna următoare">
        Următoare <ChevronRight className="h-4 w-4" />
      </Button>
      <input
        type="date"
        aria-label="Alegeți o dată"
        className="h-8 rounded-xl border border-border bg-surface px-2 text-sm text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-focus/30"
        value={weekStart}
        onChange={(e) => e.target.value && go(e.target.value)}
      />
      <span className="text-sm font-medium text-muted">
        {fmt(weekStart)} – {fmt(weekEnd)}
      </span>
    </div>
  );
}
