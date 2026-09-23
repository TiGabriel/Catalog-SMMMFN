"use client";

import { useTheme } from "next-themes";
import { useState, useSyncExternalStore } from "react";
import { KeyRound, LogOut, Monitor, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api-client";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // true only on the client (the theme is unknown during server rendering)
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const options = [
    { value: "light", label: "Mod luminos", Icon: Sun },
    { value: "dark", label: "Mod întunecat", Icon: Moon },
    { value: "system", label: "Ca sistemul", Icon: Monitor },
  ];
  return (
    <div role="radiogroup" aria-label="Temă" className="flex items-center rounded-xl border border-border bg-surface p-0.5">
      {options.map(({ value, label, Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={label}
            aria-label={label}
            onClick={() => setTheme(value)}
            className={`rounded-lg p-1.5 transition-colors ${active ? "bg-primary text-primary-contrast" : "text-muted hover:text-text"}`}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

export function UserMenu({ displayName }: { displayName: string }) {
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    await api("POST", "/api/auth/logout");
    window.location.assign(new URL("/autentificare", window.location.origin));
  }
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <ThemeToggle />
      <span className="hidden max-w-56 truncate text-sm font-medium text-text md:inline" title={displayName}>
        {displayName}
      </span>
      <Link href="/schimbare-parola" className="rounded-xl p-2 text-muted transition-colors hover:bg-surface-2 hover:text-text" title="Schimbare parolă" aria-label="Schimbare parolă">
        <KeyRound className="h-4 w-4" />
      </Link>
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:bg-danger-soft hover:text-danger"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden sm:inline">Ieșire</span>
      </button>
    </div>
  );
}
