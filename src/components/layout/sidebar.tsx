"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Archive, BarChart3, BookOpen, CalendarDays, GraduationCap, Grid3x3, Home, Inbox, Layers, Link2, List, Menu, Settings,
  ShieldCheck, Upload, User, Users, X,
} from "lucide-react";
import type { NavGroup } from "@/components/layout/nav";
import { cn } from "@/lib/cn";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  home: Home, book: BookOpen, list: List, user: User, calendar: CalendarDays, inbox: Inbox, chart: BarChart3, shield: ShieldCheck,
  users: Users, archive: Archive, layers: Layers, graduation: GraduationCap, grid: Grid3x3, link: Link2, upload: Upload, settings: Settings,
};

function isActive(pathname: string, href: string) {
  if (href === "/catalog") return pathname === "/catalog" || (pathname.startsWith("/catalog/") && !pathname.startsWith("/catalog/notele-mele"));
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLinks({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Meniu principal" className="flex flex-col gap-6">
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.title && <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-text/60">{g.title}</p>}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const Icon = ICONS[item.icon] ?? Home;
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-150",
                      active ? "bg-sidebar-active font-medium text-white" : "text-sidebar-text hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", active ? "text-accent" : "text-sidebar-text/70 group-hover:text-accent")} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/panou" className="flex items-center gap-3 px-2">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-accent ring-1 ring-white/10">
        <svg viewBox="0 0 64 64" className="h-6 w-6" aria-hidden>
          <path d="M32 10v36M22 18h20M18 36c2 8 8 13 14 13s12-5 14-13" stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round" />
        </svg>
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-white">Catalog SMMMFN</span>
        <span className="block text-xs text-sidebar-text/80">„Amiral Ion Murgescu”</span>
      </span>
    </Link>
  );
}

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 flex-col gap-8 overflow-y-auto bg-sidebar px-3 py-5 lg:flex">
        <Brand />
        <NavLinks groups={groups} />
      </aside>

      <div className="no-print sticky top-0 z-30 flex items-center justify-between bg-sidebar px-4 py-3 lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-xl p-2 text-white hover:bg-white/10"
          aria-label="Deschide meniul"
          aria-expanded={open}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Meniu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col gap-8 overflow-y-auto bg-sidebar px-3 py-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl p-2 text-white hover:bg-white/10" aria-label="Închide meniul">
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavLinks groups={groups} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
