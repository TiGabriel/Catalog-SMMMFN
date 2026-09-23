import type { Metadata } from "next";
import { getPageActor } from "@/server/http/page";
import { ChangePasswordForm } from "./form";

export const metadata: Metadata = { title: "Schimbare parolă" };
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const actor = await getPageActor({ allowPendingPasswordChange: true });
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-card">
        <h1 className="text-2xl font-bold tracking-tight">Schimbare parolă</h1>
        <p className="mt-1 text-sm text-muted">
          {actor.mustChangePassword
            ? "Pentru siguranța contului, trebuie să vă setați o parolă nouă înainte de a continua."
            : "Alegeți o parolă nouă pentru contul dumneavoastră."}
        </p>
        <ChangePasswordForm mandatory={actor.mustChangePassword} />
      </div>
    </div>
  );
}
