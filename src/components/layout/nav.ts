import type { Capabilities } from "@/server/domain/profile";

export type NavItem = { href: string; label: string; icon: string };
export type NavGroup = { title?: string; items: NavItem[] };

/** Navigation built on the server from capability flags (the server re-checks every page and API call). */
export function buildNav(caps: Capabilities): NavGroup[] {
  const main: NavItem[] = [{ href: "/panou", label: "Panou", icon: "home" }];
  if (caps.claseleMele || caps.catalogGeneral) main.push({ href: "/catalog", label: caps.catalogGeneral ? "Catalog" : "Clasele mele", icon: "book" });
  if (caps.introducereNote) main.push({ href: "/catalog/notele-mele", label: "Notele introduse", icon: "list" });
  if (caps.noteleMele) main.push({ href: "/elev", label: "Situația mea", icon: "user" });
  if (caps.orar) main.push({ href: "/orar", label: "Orar", icon: "calendar" });
  if (caps.cereriCorectie) main.push({ href: "/cereri-corectie", label: "Cereri de corecție", icon: "inbox" });
  if (caps.rapoarte) main.push({ href: "/rapoarte", label: "Rapoarte", icon: "chart" });
  if (caps.audit) main.push({ href: "/audit", label: caps.administrare ? "Jurnal de audit" : "Audit note", icon: "shield" });

  const groups: NavGroup[] = [{ items: main }];
  if (caps.administrare) {
    groups.push({
      title: "Administrare",
      items: [
        { href: "/administrare/utilizatori", label: "Utilizatori", icon: "users" },
        { href: "/administrare/ani-scolari", label: "Ani școlari", icon: "archive" },
        { href: "/administrare/clase", label: "Clase", icon: "layers" },
        { href: "/administrare/elevi", label: "Elevi", icon: "graduation" },
        { href: "/administrare/materii", label: "Materii", icon: "book" },
        { href: "/administrare/module", label: "Module", icon: "grid" },
        { href: "/administrare/repartizari", label: "Repartizări", icon: "link" },
        { href: "/administrare/orar", label: "Orar (import)", icon: "upload" },
        { href: "/administrare/configurare", label: "Configurare", icon: "settings" },
      ],
    });
  }
  return groups;
}
