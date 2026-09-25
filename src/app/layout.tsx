import type { Metadata } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import { accentCssVariables, DEFAULT_BRANDING, sidebarCssVariables } from "@/lib/branding";
import { faviconHref } from "@/lib/favicon";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import "./globals.css";

// Voces de acento (serif y mono): next/font las descarga en BUILD y las sirve
// self-hosted (sin CDN en runtime: soberanía). La letra de la interfaz es la
// del sistema (Segoe UI en Windows, San Francisco en Apple, Roboto en
// Android): no se descarga nada y se ve nativa en cada equipo.
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  return {
    title: `${branding.name} — CRM de WhatsApp`,
    description: "CRM de WhatsApp con agente de IA y Laboratorio de auto-evaluación",
    // El `?v=` cambia con la marca: los navegadores guardan el favicon con una
    // insistencia notable y, sin eso, el logo nuevo tarda días en aparecer.
    icons: { icon: faviconHref(branding) },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const branding = await getBranding().catch(() => DEFAULT_BRANDING);
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );
  return (
    <html
      lang="es"
      className={`${instrumentSerif.variable} ${plexMono.variable}`}
      // La preferencia siempre es explícita: el tema viaja resuelto en el HTML
      // del servidor, así que no hay divergencia con el cliente ni parpadeo.
      data-theme={theme}
    >
      <head>
        {/* Acento white-label y color de la barra lateral, inyectados en
            SSR: sin flash de tema. La barra va después: pisa el acento de
            `.nav-dark` cuando es de color. */}
        <style
          dangerouslySetInnerHTML={{
            __html: accentCssVariables(branding.accent) + sidebarCssVariables(branding.sidebar),
          }}
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
