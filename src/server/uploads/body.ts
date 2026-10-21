import { apiError } from "@/lib/api";
import { HEAVY_UPLOAD_BYTES, MAX_HEAVY_UPLOADS, UPLOAD_ENVELOPE_BYTES } from "@/lib/upload-limits";

/**
 * 044 — Lectura segura de una subida (multipart). Dos defensas para que un
 * archivo grande no tumbe el proceso:
 *
 * 1. `readUploadForm`: rechaza por `content-length` ANTES de leer (el archivo
 *    no llega a memoria) y, si el cliente no lo declara o miente, cuenta los
 *    bytes mientras llegan y corta al pasar el tope.
 * 2. `withUploadSlot`: a lo más `MAX_HEAVY_UPLOADS` subidas de más de 10 MB a
 *    la vez en el proceso; la siguiente recibe 503 con «intenta en un minuto».
 */

function declaredLength(req: Request): number | null {
  const raw = req.headers.get("content-length");
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function readUploadForm(
  req: Request,
  maxFileBytes: number,
  tooLarge: () => Response
): Promise<{ ok: true; form: FormData } | { ok: false; response: Response }> {
  const maxBody = maxFileBytes + UPLOAD_ENVELOPE_BYTES;
  const declared = declaredLength(req);
  if (declared !== null && declared > maxBody) return { ok: false, response: tooLarge() };

  let exceeded = false;
  let source = req;
  if (req.body) {
    let seen = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBody) {
          exceeded = true;
          controller.error(new Error("too_large"));
          return;
        }
        controller.enqueue(chunk);
      },
    });
    source = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body.pipeThrough(counter),
      duplex: "half",
    } as RequestInit);
  }
  try {
    return { ok: true, form: await source.formData() };
  } catch {
    if (exceeded) return { ok: false, response: tooLarge() };
    return { ok: false, response: apiError(400, "invalid", "Se esperaba multipart/form-data") };
  }
}

let heavyInFlight = 0;

/** Solo para pruebas: cuántas subidas pesadas corren ahora. */
export function heavyUploadsInFlight(): number {
  return heavyInFlight;
}

export async function withUploadSlot(req: Request, run: () => Promise<Response>): Promise<Response> {
  // Los navegadores siempre declaran el tamaño de un FormData. Sin él (un
  // cliente «chunked») no hace fila: `readUploadForm` igual lo corta en el tope.
  const declared = declaredLength(req);
  if (declared === null || declared <= HEAVY_UPLOAD_BYTES) return run();
  if (heavyInFlight >= MAX_HEAVY_UPLOADS) {
    const res = apiError(
      503,
      "upload_busy",
      "Hay otras subidas grandes en curso. Intenta de nuevo en un minuto."
    );
    res.headers.set("retry-after", "30");
    return res;
  }
  heavyInFlight++;
  try {
    return await run();
  } finally {
    heavyInFlight--;
  }
}
