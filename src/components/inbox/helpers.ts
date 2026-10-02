/** Utilidades de presentación de la bandeja. */

import type { ClipboardEvent } from "react";

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

export function formatRemaining(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const MEDIA_LABELS: Record<string, string> = {
  image: "Imagen",
  audio: "Audio",
  video: "Video",
  document: "Documento",
  sticker: "Sticker",
  location: "Ubicación",
  contacts: "Contacto compartido",
  template: "Plantilla",
};

export function mediaLabel(type: string): string {
  return MEDIA_LABELS[type] ?? "Contenido";
}

/** 008 — Tamaño humano de un adjunto. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function previewText(preview: string | null): string {
  if (!preview) return "";
  return MEDIA_LABELS[preview] ? `📎 ${MEDIA_LABELS[preview]}` : preview;
}

/**
 * La imagen pegada con Ctrl+V llega como "image.png" (o sin nombre): se le da
 * uno con fecha para que no lleguen diez "image.png" iguales.
 */
export function namePasted(f: File): File {
  if (f.name && f.name !== "image.png") return f;
  const ext = f.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return new File([f], `imagen-${stamp}.${ext}`, { type: f.type });
}

/**
 * Ctrl+V con una imagen en el portapapeles = adjuntarla, igual que elegirla
 * del explorador. Si trae texto (aunque también traiga imagen, como al
 * copiar celdas de Excel) devuelve null y se pega el texto como siempre.
 * Cuando hay imagen, cancela el pegado y la devuelve ya con nombre.
 * Lo comparten la Bandeja y el chat de equipo.
 */
export function takePastedImage(e: ClipboardEvent<HTMLElement>): File | null {
  if (e.clipboardData.getData("text/plain")) return null;
  const image = Array.from(e.clipboardData.items)
    .find((i) => i.kind === "file" && i.type.startsWith("image/"))
    ?.getAsFile();
  if (!image) return null;
  e.preventDefault();
  return namePasted(image);
}
