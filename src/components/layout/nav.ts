import type { Capabilities } from "@/server/domain/profile";

export type NavItem = { href: string; label: string; icon: string };
export type NavGroup = { title?: string; items: NavItem[] };

/** Navigation built on the server from capability flags (the server re-checks every page and API call). */
export function buildNav(caps: Capabilities): NavGroup[] {
  const main: NavItem[] = [{ href: "/panou", label: "Panou", icon: "home" }];
  if (caps.claseleMele || caps.catalogGeneral) main.push({ href: "/catalog", label: caps.catalogGeneral ? "Catalog" : "Clasele mele", icon: "book" });
  if (caps.introducereNote) main.push({ href: "/catalog/notele-mele", label: "Notele introduse", icon: "list" });
  if (caps.noteleMele) main.push({ href: "/elev", label: "Situația mea", icon: "user" });
  // Orar (phase 3)
  if (caps.cereriCorectie) main.push({ href: "/cereri-corectie", label: "Cereri de corecție", icon: "inbox" });
  // Rapoarte and Jurnal de audit (phase 4)

  const groups: NavGroup[] = [{ items: main }];
  if (caps.administrare) {
    groups.push({
      title: "Administrare",
      items: [
        { href: "/administrare/elevi", label: "Elevi", icon: "graduation" },
        { href: "/administrare/materii", label: "Materii", icon: "book" },
        { href: "/administrare/module", label: "Module", icon: "grid" },
        { href: "/administrare/repartizari", label: "Repartizări", icon: "link" },
      ],
    });
  }
  return groups;
}
