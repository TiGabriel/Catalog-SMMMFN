"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { inputClass } from "@/components/ui";

/** Select that writes its value into the URL query (server components re-render and re-authorize). */
export function FilterSelect({
  param,
  label,
  value,
  options,
  clears = [],
  emptyLabel = "Toate",
}: {
  param: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  clears?: string[];
  emptyLabel?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <select
        className={`${inputClass} h-8 w-auto min-w-36`}
        value={value}
        onChange={(e) => {
          const p = new URLSearchParams(params.toString());
          if (e.target.value) p.set(param, e.target.value);
          else p.delete(param);
          for (const c of clears) p.delete(c);
          router.push(`?${p.toString()}`);
        }}
      >
        <option value="">{emptyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
