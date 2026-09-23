import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader, TableWrap } from "@/components/ui";
import { ApiForm } from "@/components/admin/api-form";
import { getPageActor, load } from "@/server/http/page";
import { listRanks, listUsers } from "@/server/domain/users";
import { PASSWORD_POLICY_TEXT } from "@/lib/validation/password";
import { ROLE_LABEL, USER_STATUS_LABEL, formatDateTime, personName } from "@/lib/format";

export const metadata: Metadata = { title: "Utilizatori" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ rol?: string }> }) {
  const sp = await searchParams;
  const actor = await getPageActor();
  const [users, ranks] = await Promise.all([load(listUsers(actor)), listRanks()]);
  const roleFilter = Object.keys(ROLE_LABEL).includes(sp.rol ?? "") ? sp.rol : undefined;
  const shown = roleFilter ? users.filter((u) => u.role === roleFilter) : users;

  return (
    <>
      <PageHeader title="Utilizatori" subtitle="Rolurile sunt vizibile doar administratorilor. Conturile nu se șterg fizic: istoricul rămâne legat de persoană." />
      <Card className="mb-6">
        <CardHeader title="Cont nou" description={`Parola temporară trebuie schimbată la prima autentificare. ${PASSWORD_POLICY_TEXT}`} />
        <ApiForm
          action="/api/admin/users"
          submitLabel="Creează contul"
          successMessage="Contul a fost creat. Comunicați parola temporară pe un canal sigur."
          columns={3}
          fields={[
            { name: "lastName", label: "Nume", type: "text", required: true },
            { name: "firstName", label: "Prenume", type: "text", required: true },
            { name: "rankId", label: "Grad militar", type: "select", options: ranks.map((r) => ({ value: r.id, label: r.label })), emptyLabel: "— (personal civil contractual)" },
            { name: "username", label: "Nume de utilizator", type: "text", required: true, placeholder: "ex. prof.ionescu" },
            {
              name: "role",
              label: "Rol",
              type: "select",
              required: true,
              options: [
                { value: "PROFESOR", label: ROLE_LABEL.PROFESOR! },
                { value: "COMANDANT_UNITATE", label: ROLE_LABEL.COMANDANT_UNITATE! },
                { value: "ADMINISTRATOR", label: ROLE_LABEL.ADMINISTRATOR! },
              ],
              hint: "Dirigintele este un profesor numit la Repartizări.",
            },
            { name: "temporaryPassword", label: "Parolă temporară", type: "password", required: true },
          ]}
        />
      </Card>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="?" className={`rounded-full border px-3 py-1 text-sm ${!roleFilter ? "border-primary bg-primary text-primary-contrast" : "border-border hover:bg-surface-2"}`}>Toți</Link>
        {Object.entries(ROLE_LABEL).map(([k, v]) => (
          <Link key={k} href={`?rol=${k}`} className={`rounded-full border px-3 py-1 text-sm ${roleFilter === k ? "border-primary bg-primary text-primary-contrast" : "border-border hover:bg-surface-2"}`}>{v}</Link>
        ))}
      </div>
      <Card>
        <CardHeader title={`${shown.length} conturi`} />
        <TableWrap>
          <table className="data-table">
            <thead>
              <tr><th>Nume</th><th>Utilizator</th><th>Rol</th><th>Stare</th><th>Ultima autentificare</th></tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">
                    <Link href={`/administrare/utilizatori/${u.id}`} className="hover:text-primary hover:underline">{personName(u)}</Link>
                    {u.mustChangePassword && u.status === "ACTIVE" && <Badge tone="warning" className="ml-2">parolă temporară</Badge>}
                  </td>
                  <td className="text-muted">{u.username}</td>
                  <td><Badge tone={u.role === "ADMINISTRATOR" ? "danger" : u.role === "COMANDANT_UNITATE" ? "accent" : "primary"}>{ROLE_LABEL[u.role]}</Badge></td>
                  <td><Badge tone={u.status === "ACTIVE" ? "success" : u.status === "INACTIVE" ? "warning" : "neutral"}>{USER_STATUS_LABEL[u.status]}</Badge></td>
                  <td className="text-sm text-muted">{formatDateTime(u.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
