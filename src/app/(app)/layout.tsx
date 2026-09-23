import { AppShell } from "@/components/layout/app-shell";
import { getPageContext } from "@/server/http/page";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { actor, caps } = await getPageContext();
  return (
    <AppShell actor={actor} caps={caps}>
      {children}
    </AppShell>
  );
}
