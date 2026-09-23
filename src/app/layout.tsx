import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ThemeProvider } from "next-themes";
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Catalog electronic – SMMMFN", template: "%s · Catalog SMMMFN" },
  description: "Catalogul electronic al Școlii Militare de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b2a55" },
    { media: "(prefers-color-scheme: dark)", color: "#07111f" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="ro" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange nonce={nonce}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
