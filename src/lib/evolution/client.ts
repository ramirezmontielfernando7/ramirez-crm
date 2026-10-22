/**
 * Conexión directa (PR 3) — Cliente de MENSAJES del servidor del dispositivo
 * vinculado (Evolution API v2). Solo lo que envía: texto, archivos y
 * «escribiendo…». Crear la instancia, el QR y el estado viven en el cliente
 * del PR 2 (`src/server/direct-connection/evolution-api.ts`).
 *
 * Única salida hacia ese servidor para ENVIAR. Nadie lo llama salvo
 * `src/server/direct-connection/send.ts` (guardarraíl
 * `tests/unit/conexion-directa-envio.test.ts`): la IA, las campañas y el
 * cerebro externo nunca llegan aquí.
 *
 * Los mensajes de error de esta capa son internos (log); lo que ve una
 * persona lo traduce `send.ts` con palabras discretas.
 */

/** Tope de cada llamada, igual que el de Meta. */
export const EVOLUTION_TIMEOUT_MS = 20_000;

export type EvolutionTarget = {
  /** URL base ya normalizada (`normalizeServerUrl`), sin barra final. */
  baseUrl: string;
  /** Llave de la instancia (o la maestra del servidor). Nunca al log. */
  apiKey: string;
  instanceName: string;
};

export class EvolutionApiError extends Error {
  /** 0 = no hubo respuesta (red caída o tiempo agotado). */
  status: number;
  details: unknown;
  /** Se agotó el tiempo: el mensaje PUDO salir. No se reintenta. */
  timedOut: boolean;

  constructor(message: string, opts: { status: number; details?: unknown; timedOut?: boolean }) {
    super(message);
    this.name = "EvolutionApiError";
    this.status = opts.status;
    this.details = opts.details;
    this.timedOut = opts.timedOut ?? false;
  }
}

async function evolutionRequest<T>(
  target: EvolutionTarget,
  path: string,
  body: unknown,
  timeoutMs = EVOLUTION_TIMEOUT_MS
): Promise<T> {
  const url = `${target.baseUrl}/${path}/${encodeURIComponent(target.instanceName)}`;
  const signal = AbortSignal.timeout(timeoutMs);
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      signal,
      method: "POST",
      headers: { apikey: target.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    text = await res.text();
  } catch (cause) {
    if (signal.aborted) {
      throw new EvolutionApiError(`sin respuesta en ${Math.round(timeoutMs / 1000)} s`, {
        status: 0,
        timedOut: true,
      });
    }
    throw new EvolutionApiError("no se pudo contactar el servidor", { status: 0, details: String(cause) });
  }

  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // respuesta no-JSON: se conserva el texto crudo
  }
  if (!res.ok) {
    throw new EvolutionApiError(errorText(json) ?? `respondió ${res.status}`, {
      status: res.status,
      details: json ?? text.slice(0, 500),
    });
  }
  return json as T;
}

/** El mensaje de error de Evolution v2: `{ response: { message: [...] } }` o `{ message }`. */
function errorText(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const o = json as { message?: unknown; error?: unknown; response?: { message?: unknown } };
  const raw = o.response?.message ?? o.message ?? o.error;
  if (typeof raw === "string") return raw.slice(0, 300);
  if (Array.isArray(raw)) return JSON.stringify(raw).slice(0, 300);
  return null;
}

type SendResponse = { key?: { id?: unknown } };

/** El ID que el servidor le dio al mensaje (`key.id`). Sin él, el envío no se dio por bueno. */
function messageIdOf(res: SendResponse): string {
  const id = res?.key?.id;
  if (typeof id !== "string" || !id) {
    throw new EvolutionApiError("respuesta sin key.id", { status: 200, details: res });
  }
  return id;
}

/** «escribiendo…» durante `delayMs`. El servidor espera ese tiempo antes de responder. */
export async function sendPresence(target: EvolutionTarget, number: string, delayMs: number): Promise<void> {
  await evolutionRequest(
    target,
    "chat/sendPresence",
    { number, presence: "composing", delay: delayMs },
    EVOLUTION_TIMEOUT_MS + delayMs
  );
}

export async function sendTextMessage(target: EvolutionTarget, number: string, text: string): Promise<string> {
  return messageIdOf(await evolutionRequest<SendResponse>(target, "message/sendText", { number, text }));
}

export type DirectMedia = {
  kind: "image" | "video" | "audio" | "document";
  mimeType: string;
  fileName?: string | null;
  caption?: string | null;
  data: Buffer;
};

/**
 * Archivos: imagen, video y documento por `sendMedia`; el audio por
 * `sendWhatsAppAudio` (llega como nota de voz). En base64 sin prefijo.
 */
export async function sendMediaFile(target: EvolutionTarget, number: string, media: DirectMedia): Promise<string> {
  const base64 = media.data.toString("base64");
  // Un archivo grande tarda en subir: un minuto más de tope por cada 10 MB.
  const timeoutMs = EVOLUTION_TIMEOUT_MS + Math.ceil(media.data.byteLength / 10_000_000) * 60_000;
  if (media.kind === "audio") {
    return messageIdOf(
      await evolutionRequest<SendResponse>(target, "message/sendWhatsAppAudio", { number, audio: base64 }, timeoutMs)
    );
  }
  return messageIdOf(
    await evolutionRequest<SendResponse>(
      target,
      "message/sendMedia",
      {
        number,
        mediatype: media.kind,
        mimetype: media.mimeType,
        media: base64,
        ...(media.caption ? { caption: media.caption } : {}),
        ...(media.fileName ? { fileName: media.fileName } : {}),
      },
      timeoutMs
    )
  );
}
