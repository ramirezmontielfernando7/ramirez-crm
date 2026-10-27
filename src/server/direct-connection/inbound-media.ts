import { EvolutionApiError, fetchMediaBase64 } from "@/lib/evolution/client";
import { openDirectTarget } from "@/server/credentials/direct-instance";

/**
 * Conexión directa (PR 6) — Descarga el archivo de un mensaje que entró por
 * el dispositivo vinculado (empresa sin Meta). Lo llama SOLO
 * `ensureAssetAvailable` (`src/server/whatsapp/media.ts`) cuando el
 * `wa_media_id` es `direct:<key.id>`; el resto (guardar en disco, marcar
 * disponible o fallido, reintentar al abrirlo) es el camino de siempre.
 */
export async function downloadDeviceMedia(
  organizationId: string,
  keyId: string,
  maxBytes: number,
  /** 046: lo que entró por un «Mi número» se descarga de SU dispositivo. */
  directNumberId: string | null = null
): Promise<{ data: Buffer; mimeType: string | null; fileSize: number }> {
  const opened = await openDirectTarget(organizationId, directNumberId);
  if (!opened.ok) throw new Error("El dispositivo vinculado no está disponible para descargar el archivo");
  let file: Awaited<ReturnType<typeof fetchMediaBase64>>;
  try {
    file = await fetchMediaBase64(opened.target, { id: keyId });
  } catch (err) {
    // Sin el cuerpo ni la llave: solo qué pasó.
    const status = err instanceof EvolutionApiError ? err.status : 0;
    throw new Error(`El dispositivo vinculado no entregó el archivo (${status || "sin respuesta"})`);
  }
  if (file.data.byteLength === 0) throw new Error("El dispositivo vinculado entregó un archivo vacío");
  if (file.data.byteLength > maxBytes) throw new Error("El adjunto excede el límite de tamaño");
  return { data: file.data, mimeType: file.mimeType, fileSize: file.data.byteLength };
}
