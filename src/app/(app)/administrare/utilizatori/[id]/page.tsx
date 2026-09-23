import type { Metadata } from "next";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ActionButton, ApiForm } from "@/components/admin/api-form";
import { getPageActor, load } from "@/server/http/page";
import { getUser, listRanks } from "@/server/domain/users";
import { PASSWORD_POLICY_TEXT } from "@/lib/validation/password";
import { ROLE_LABEL, USER_STATUS_LABEL, formatDateTime, personName } from "@/lib/format";

export const metadata: Metadata = { title: "Utilizator" };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getPageActor();
  const [u, ranks] = await Promise.all([load(getUser(actor, id)), listRanks()]);
  const self = u.id === actor.userId;
  const deleted = u.status === "DELETED";

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Utilizatori", href: "/administrare/utilizatori" }, { label: personName(u) }]}
        title={personName(u)}
        subtitle={`${u.username} · ${ROLE_LABEL[u.role]} · creat ${formatDateTime(u.createdAt)} · ultima autentificare ${formatDateTime(u.lastLoginAt)}`}
        actions={<Badge tone={u.status === "ACTIVE" ? "success" : "warning"}>{USER_STATUS_LABEL[u.status]}</Badge>}
      />
      {self && <div className="mb-6"><Alert tone="primary">Acesta este propriul cont. Rolul și starea propriului cont nu pot fi modificate; parola se schimbă din „Schimbare parolă”.</Alert></div>}
      {deleted ? (
        <Alert tone="warning">Contul a fost șters: autentificarea nu mai este posibilă, dar notele și intrările de audit rămân legate de această persoană.</Alert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Date personale și rol" description="Schimbarea rolului închide toate sesiunile utilizatorului." />
            <ApiForm
              method="PATCH"
              action={`/api/admin/users/${u.id}`}
              submitLabel="Salvează"
              successMessage="Datele au fost actualizate."
              columns={2}
              onSuccessReset={false}
              fields={[
                { name: "lastName", label: "Nume", type: "text", defaultValue: u.lastName },
                { name: "firstName", label: "Prenume", type: "text", defaultValue: u.firstName },
                { name: "rankId", label: "Grad militar", type: "select", defaultValue: u.rank?.id ?? "", options: ranks.map((r) => ({ value: r.id, label: r.label })), emptyLabel: "— (civil)" },
                ...(!self && u.role !== "ELEV"
                  ? [{
                      name: "role",
                      label: "Rol",
                      type: "select" as const,
                      required: true,
                      defaultValue: u.role,
                      options: [
                        { value: "PROFESOR", label: ROLE_LABEL.PROFESOR! },
                        { value: "COMANDANT_UNITATE", label: ROLE_LABEL.COMANDANT_UNITATE! },
                        { value: "ADMINISTRATOR", label: ROLE_LABEL.ADMINISTRATOR! },
                      ],
                    }]
                  : []),
              ]}
            />
          </Card>
          {!self && (
            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader title="Resetare parolă" description={`Utilizatorul va fi obligat să o schimbe la autentificare; sesiunile sale sunt închise. ${PASSWORD_POLICY_TEXT}`} />
                <ApiForm
                  action={`/api/admin/users/${u.id}/reset-password`}
                  submitLabel="Resetează parola"
                  successMessage="Parola a fost resetată."
                  columns={2}
                  fields={[{ name: "temporaryPassword", label: "Parolă temporară nouă", type: "password", required: true }]}
                />
              </Card>
              <Card>
                <CardHeader title="Starea contului" description="Dezactivarea închide imediat sesiunile. Ștergerea elimină definitiv autentificarea, dar păstrează istoricul." />
                <div className="flex flex-wrap gap-2 p-5">
                  {u.status === "ACTIVE" && <ActionButton action={`/api/admin/users/${u.id}/status`} body={{ status: "INACTIVE" }} label="Dezactivează" reasonPrompt="Motivul dezactivării:" />}
                  {u.status === "INACTIVE" && <ActionButton action={`/api/admin/users/${u.id}/status`} body={{ status: "ACTIVE" }} label="Reactivează" reasonPrompt="Motivul reactivării:" variant="primary" />}
                  <ActionButton action={`/api/admin/users/${u.id}/status`} body={{ status: "DELETED" }} label="Șterge contul" reasonPrompt="Ștergerea este definitivă. Motivul ștergerii:" variant="danger" />
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </>
  );
}
