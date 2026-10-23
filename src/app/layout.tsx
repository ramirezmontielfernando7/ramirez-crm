import type { Metadata } from "next";
import { cookies } from "next/headers";
import localFont from "next/font/local";
import "@fontsource-variable/geist";
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/dm-sans";
import {
  CHAT_STYLE_COOKIE,
  FONT_COOKIE,
  UI_STYLE_COOKIE,
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
// Letras: archivos .woff2 dentro del repo (src/app/fonts, licencia OFL) que
// next/font/local sirve self-hosted desde la propia instancia. Antes eran
// next/font/google, que las descargaba en BUILD y tumbaba el despliegue
// cuando Google no respondía. Inter es la letra de la interfaz (400
// contenido, 500 interfaz, 600 títulos; ver --font-ui en globals.css); IBM
// Plex Mono queda para etiquetas y horas.
const inter = localFont({
  src: [
    { path: "./fonts/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});
const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
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
      uiStyle: jar.get(UI_STYLE_COOKIE)?.value,
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
      data-ui={look.uiStyle}
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
