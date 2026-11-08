import type { MetadataRoute } from "next";
import { getViewerBrandingContext } from "@/server/branding";
import { faviconHref } from "@/lib/favicon";

export const dynamic = "force-dynamic";

/**
 * Manifiesto de la app instalable. Sin él, «Añadir a la pantalla de inicio»
 * crea un atajo del navegador y Chrome pinta arriba la barra con el título y
 * la dirección. Con `display: standalone` se abre como app, sin esa barra.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { branding } = await getViewerBrandingContext();
  const icon = faviconHref(branding);
  return {
    name: `${branding.name} — CRM de WhatsApp`,
    short_name: branding.name,
    description: "CRM de WhatsApp con agentes de IA",
    id: "/",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    lang: "es",
    icons: [
      { src: icon, sizes: "any", purpose: "any" },
      { src: icon, sizes: "any", purpose: "maskable" },
    ],
  };
}
