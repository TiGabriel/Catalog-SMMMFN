"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  // No technical details are shown to the user; the server log has the request id.
  return (
    <div className="grid min-h-[60vh] place-items-center px-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold">A apărut o eroare</h1>
        <p className="mt-2 text-muted">Operațiunea nu a putut fi finalizată. Vă rugăm să încercați din nou.</p>
        <button onClick={reset} className="mt-6 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-contrast hover:bg-primary-hover">
          Reîncearcă
        </button>
      </div>
    </div>
  );
}
