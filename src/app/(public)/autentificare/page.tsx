import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Autentificare" };

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-sidebar lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(91,143,224,0.35),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(201,162,39,0.18),transparent_50%)]" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 text-accent ring-1 ring-white/15">
              <svg viewBox="0 0 64 64" className="h-7 w-7" aria-hidden>
                <path d="M32 10v36M22 18h20M18 36c2 8 8 13 14 13s12-5 14-13" stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round" />
              </svg>
            </span>
            <span className="text-lg font-semibold">Catalog electronic</span>
          </div>
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-accent">Forțele Navale Române</p>
            <h1 className="mt-4 max-w-lg text-4xl font-bold leading-tight">
              Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”
            </h1>
            <p className="mt-4 max-w-md text-sidebar-text">Evidența situației școlare, a modulelor și a orarului – acces securizat pentru personalul autorizat.</p>
          </div>
          <p className="text-xs text-sidebar-text/70">Acces restricționat. Toate operațiunile sunt înregistrate.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <p className="text-xs uppercase tracking-[0.2em] text-primary">Catalog electronic</p>
            <p className="mt-2 text-lg font-semibold">SMMMFN „Amiral Ion Murgescu”</p>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Autentificare</h2>
          <p className="mt-1 text-sm text-muted">Introduceți numele de utilizator și parola.</p>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
