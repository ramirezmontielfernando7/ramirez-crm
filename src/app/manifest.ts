import type { MetadataRoute } from "next";

/**
 * Manifiesto de la PWA: con `display: standalone` Chrome (Android) instala
 * el CRM como app real, sin barra de URL. `id` fija la identidad de la app
 * aunque cambie `start_url`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Dashfort — CRM de WhatsApp",
    short_name: "Dashfort",
    description: "CRM de WhatsApp con agentes de IA",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
