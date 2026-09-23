import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { UserMenu } from "@/components/layout/user-menu";
import { buildNav } from "@/components/layout/nav";
import type { Capabilities } from "@/server/domain/profile";
import type { Actor } from "@/server/authz/actor";
import { actorDisplayName } from "@/server/authz/actor";

export function AppShell({ actor, caps, children }: { actor: Actor; caps: Capabilities; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <Sidebar groups={buildNav(caps)} />
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 hidden items-center justify-between gap-4 border-b border-border bg-surface/85 px-6 py-3 backdrop-blur lg:flex">
          <p className="truncate text-sm text-muted">Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”</p>
          <UserMenu displayName={actorDisplayName(actor)} />
        </header>
        <div className="no-print flex justify-end border-b border-border bg-surface px-4 py-2 lg:hidden">
          <UserMenu displayName={actorDisplayName(actor)} />
        </div>
        <main id="continut" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
