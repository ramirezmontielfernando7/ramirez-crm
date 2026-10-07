import type { Metadata } from "next";
import { cookies } from "next/headers";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "@fontsource-variable/geist";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/dm-sans";
import {
  CHAT_STYLE_COOKIE,
  FONT_COOKIE,
  readPersonalAppearance,
  resolveAppearance,
} from "@/lib/appearance";
import { getOrgAppearance } from "@/server/appearance";
import { accentCssVariables, sidebarCssVariables } from "@/lib/branding";
import { faviconHref } from "@/lib/favicon";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getViewerBrandingContext } from "@/server/branding";
import "./globals.css";

// Fase D: Geist, Plus Jakarta Sans y DM Sans vienen de paquetes npm
// (@fontsource-variable, empaquetados con la app: sin Google Fonts en
// runtime) y solo se descarga la que se use. Cuál se pinta lo decide
// `data-font` (globals.css).
// Letras: next/font las descarga en BUILD y las sirve self-hosted desde la
// propia instancia (sin CDN en runtime: soberanía). Inter es la letra de la
// interfaz (400 contenido, 500 interfaz, 600 títulos; ver --font-ui en
// globals.css); IBM Plex Mono queda para etiquetas y horas.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
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
  // H11: con sesión, la marca de SU negocio; sin sesión, la de la plataforma.
  const { branding } = await getViewerBrandingContext();
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
  const { branding, organizationId } = await getViewerBrandingContext();
  const jar = await cookies();
  const theme = normalizeThemePreference(jar.get(THEME_COOKIE)?.value);
  // Fase D: la preferencia personal (cookie) pisa la de la organización.
  const look = resolveAppearance(
    await getOrgAppearance(organizationId),
    readPersonalAppearance({
      font: jar.get(FONT_COOKIE)?.value,
      chatStyle: jar.get(CHAT_STYLE_COOKIE)?.value,
    })
  );
  return (
    <html
      lang="es"
      className={`${inter.variable} ${plexMono.variable}`}
      // La preferencia siempre es explícita: el tema viaja resuelto en el HTML
      // del servidor, así que no hay divergencia con el cliente ni parpadeo.
      data-theme={theme}
      data-font={look.font}
      data-chat={look.chatStyle}
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
