/**
 * Conexión directa (PR 4) — reglas PURAS para unir lo que sale por el
 * dispositivo vinculado con su eco de Meta (`smb_message_echoes`) y para
 * leer los estados de entrega que manda el dispositivo. Sin BD ni red: todo
 * se prueba en `tests/unit/conexion-directa-ecos.test.ts`.
 *
 * Fase 0 (Evolution 2.3.7, 3 de 3): el `wa_message_id` del eco
 * (`wamid.` + base64) decodificado TERMINA con el `key.id` que el
 * dispositivo le dio al mismo mensaje. Esa es la unión EXACTA; chat + texto +
 * hora solo es el respaldo cuando el ID no se puede leer.
 */

/** Lo más largo que puede ser un ID del dispositivo (los vistos miden 16-32). */
const MAX_ID = 64;
/** Lo más corto que aceptamos como ID (los teléfonos y llaves cortas no cuentan). */
const MIN_ID = 8;

function decodeWamid(wamid: string): Buffer | null {
  const raw = wamid.trim().replace(/^wamid\./i, "");
  if (raw.length < 8 || !/^[A-Za-z0-9+/_=-]+$/.test(raw)) return null;
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bytes = Buffer.from(padded, "base64");
  return bytes.length > 0 ? bytes : null;
}

const isIdByte = (b: number) => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);

/**
 * El ID del dispositivo que viene dentro de un `wamid` de Meta, o null si no
 * se puede leer. Forma vista: `… 0x18 <largo> <ID en ASCII> 0x00`. Si la
 * forma cambia, se toma el último tramo de letras y números.
 */
export function directIdFromWamid(wamid: string | null | undefined): string | null {
  if (!wamid) return null;
  const bytes = decodeWamid(wamid);
  if (!bytes) return null;
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0x00) end--;
  // 1) Por estructura: el campo con su largo justo antes, que llega al final.
  for (let len = MIN_ID; len <= Math.min(MAX_ID, end - 2); len++) {
    const start = end - len;
    if (bytes[start - 1] !== len || bytes[start - 2] !== 0x18) continue;
    const id = bytes.subarray(start, end);
    if (id.every(isIdByte)) return id.toString("latin1");
  }
  // 2) Respaldo: el último tramo de letras y números.
  let i = end;
  while (i > 0 && isIdByte(bytes[i - 1]!)) i--;
  const len = end - i;
  return len >= MIN_ID && len <= MAX_ID ? bytes.subarray(i, end).toString("latin1") : null;
}

/* ───────── Respaldo: chat + texto + hora ───────── */

/** Qué tan lejos puede estar el eco del envío para unirlos sin ID. */
export const ECHO_FALLBACK_MS = 2 * 60 * 1000;

export type EchoCandidate = {
  id: string;
  type: string;
  text: string | null;
  status: string;
  /** ID del dispositivo; null si el envío no llegó a saberlo (se agotó el tiempo). */
  altMessageId: string | null;
  /** Hora en que salió (o se intentó). */
  at: Date;
};

export type EchoFacts = {
  type: string;
  text: string | null;
  at: Date;
  /** El ID del dispositivo leído del `wamid`; null si no se pudo. */
  directId: string | null;
};

const sameText = (a: string | null, b: string | null) => (a ?? "").trim() === (b ?? "").trim();

/**
 * Respaldo cuando el ID no une: el envío directo del MISMO chat, mismo tipo
 * (y mismo texto si es texto), a menos de 2 min. Nunca contradice al ID: si
 * el eco trae un ID y el envío ya tiene otro, son mensajes distintos. Gana el
 * más cercano en el tiempo.
 */
export function pickEchoFallback(echo: EchoFacts, candidates: EchoCandidate[]): EchoCandidate | null {
  let best: EchoCandidate | null = null;
  let bestGap = Infinity;
  for (const c of candidates) {
    if (echo.directId && c.altMessageId && c.altMessageId !== echo.directId) continue;
    if (c.type !== echo.type) continue;
    if (echo.type === "text" && !sameText(c.text, echo.text)) continue;
    const gap = Math.abs(c.at.getTime() - echo.at.getTime());
    if (gap > ECHO_FALLBACK_MS || gap >= bestGap) continue;
    best = c;
    bestGap = gap;
  }
  return best;
}

/* ───────── Estados de entrega del dispositivo ───────── */

export type DirectStatus = "sent" | "delivered" | "read";

export type DirectStatusUpdate = { id: string; status: DirectStatus; at: Date | null };

/** El estado de Baileys (texto o número) a nuestro vocabulario; lo demás se ignora. */
export function directStatusOf(raw: unknown): DirectStatus | null {
  if (typeof raw === "number") {
    if (raw === 2) return "sent";
    if (raw === 3) return "delivered";
    if (raw === 4 || raw === 5) return "read";
    return null;
  }
  if (typeof raw !== "string") return null;
  switch (raw.toUpperCase()) {
    case "SERVER_ACK":
      return "sent";
    case "DELIVERY_ACK":
      return "delivered";
    case "READ":
    case "PLAYED":
      return "read";
    default:
      return null;
  }
}

function timeOf(raw: unknown): Date | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  // Segundos o milisegundos, según la versión.
  return new Date(n < 1e12 ? n * 1000 : n);
}

/**
 * Los estados de un aviso `messages.update` del dispositivo. Tolerante a las
 * dos formas de Evolution v2 (`{ keyId, status, fromMe }` y
 * `{ key: { id, fromMe }, update: { status } }`, sola o en lista). Solo lo
 * que salió de nuestro número (`fromMe`) cuenta.
 */
export function parseDirectStatusUpdates(data: unknown): DirectStatusUpdate[] {
  const items = Array.isArray(data) ? data : [data];
  const out: DirectStatusUpdate[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const r = item as {
      keyId?: unknown;
      fromMe?: unknown;
      status?: unknown;
      datetime?: unknown;
      messageTimestamp?: unknown;
      key?: { id?: unknown; fromMe?: unknown };
      update?: { status?: unknown };
    };
    const id = r.keyId ?? r.key?.id;
    const fromMe = r.fromMe ?? r.key?.fromMe;
    if (typeof id !== "string" || !id || id.length > MAX_ID * 2) continue;
    if (fromMe === false) continue;
    const status = directStatusOf(r.status ?? r.update?.status);
    if (!status) continue;
    out.push({ id, status, at: timeOf(r.datetime ?? r.messageTimestamp) });
  }
  return out;
}
