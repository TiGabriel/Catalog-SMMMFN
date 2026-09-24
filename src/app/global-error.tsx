"use client";

/** Last-resort error page (replaces the root layout); Romanian, without technical details. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="ro">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#f4f6fa", color: "#0f1b2d" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>Aplicația a întâmpinat o eroare</h1>
          <p style={{ color: "#516077" }}>Vă rugăm să reîncărcați pagina. Dacă problema persistă, contactați administratorul.</p>
          <button onClick={reset} style={{ marginTop: 16, padding: "8px 16px", borderRadius: 12, border: 0, background: "#0b2a55", color: "#fff", cursor: "pointer" }}>
            Reîncearcă
          </button>
        </div>
      </body>
    </html>
  );
}
