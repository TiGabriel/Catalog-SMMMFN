import { getPageContext, requireCap } from "@/server/http/page";

/** Administration area: page-level gate (every service call is authorized again on the server). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { caps } = await getPageContext();
  requireCap(caps.administrare);
  return <>{children}</>;
}
