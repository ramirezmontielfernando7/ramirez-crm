/**
 * Conexión directa (PR 6) — reglas PURAS de lo que ENTRA por el dispositivo
 * vinculado (`messages.upsert` del servidor). Solo se usa en una empresa sin
 * conexión de Meta: con Meta, lo que escribe el contacto ya entra por Meta.
 * Sin BD ni red: todo se prueba en `tests/unit/conexion-directa-sin-meta.test.ts`.
 *
 * El resultado tiene la forma de un mensaje del webhook de Meta
 * (`WebhookMessage`) para que la ingesta de siempre lo registre igual: mismo
 * contacto, mismo lead, misma IA, mismas bajas.
 */

import { NUMBER_MEDIA_PREFIX } from "@/lib/db/tenant";
import { phoneFromDirect } from "@/lib/direct-send";
import type { WebhookMessage } from "@/server/inbox/webhook";

/** `wa_message_id` de lo que entra por el dispositivo: no choca con un `wamid.` de Meta. */
export const DEVICE_MESSAGE_PREFIX = "direct.";
/** `wa_media_id` de un archivo que se descarga del dispositivo, no de Meta. */
export const DEVICE_MEDIA_PREFIX = "direct:";

/** Lo más largo que aceptamos como ID del dispositivo. */
const MAX_ID = 128;

export type DeviceMessage = {
  /** El `key.id` del dispositivo. */
  keyId: string;
  /** Lo escribió el negocio (en el celular o desde Dashfort), no el contacto. */
  fromMe: boolean;
  /** El teléfono del contacto en la forma de Dashfort (52 + 10); null si solo vino su `@lid`. */
  phone: string | null;
  /** El ID privado del contacto (`…@lid`), si vino. */
  lid: string | null;
  /** El nombre de perfil del contacto (solo en lo que él escribe). */
  pushName: string | null;
  /** Hora en segundos, como la manda Meta (texto). */
  timestamp: string;
  message: WebhookMessage;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Las envolturas que no cambian el contenido (temporales, ver una vez, documento con texto…). */
const WRAPPERS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
  "editedMessage",
] as const;

function unwrap(message: Obj): Obj {
  let m = message;
  for (let i = 0; i < 4; i++) {
    const inner = WRAPPERS.map((w) => m[w]).find(isObj);
    const next = inner && isObj(inner.message) ? inner.message : null;
    if (!next) break;
    m = next;
  }
  return m;
}

/** Segundos de un `messageTimestamp` (número, texto o `{ low }` de protobuf). */
function secondsOf(raw: unknown, now: Date): string {
  const v = isObj(raw) ? raw.low : raw;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n === "number" && Number.isFinite(n) && n > 0) return String(Math.floor(n > 1e12 ? n / 1000 : n));
  return String(Math.floor(now.getTime() / 1000));
}

/** De una dirección del dispositivo: teléfono (`@s.whatsapp.net`) o ID privado (`@lid`). */
function addressOf(jid: unknown): { phone: string | null; lid: string | null } {
  const j = str(jid);
  if (!j) return { phone: null, lid: null };
  const [user = "", server = ""] = j.split("@");
  const digits = user.split(":")[0]!.replace(/\D/g, "");
  if (server === "lid") return { phone: null, lid: digits.length >= 6 ? `${digits}@lid` : null };
  if (server !== "s.whatsapp.net" && server !== "c.us") return { phone: null, lid: null };
  if (digits.length < 8 || digits.length > 15) return { phone: null, lid: null };
  return { phone: phoneFromDirect(digits), lid: null };
}

/** ¿Es un chat uno a uno? Grupos, estados, listas de difusión y canales no entran. */
export function isPersonalChat(jid: unknown): boolean {
  const j = str(jid);
  return !!j && (j.endsWith("@s.whatsapp.net") || j.endsWith("@c.us") || j.endsWith("@lid"));
}

/** Un contacto compartido (vCard) a la forma de Meta que ya pinta la burbuja. */
export function contactFromVcard(displayName: string | null, vcard: string | null): Obj {
  const lines = (vcard ?? "").split(/\r?\n/);
  const fn = lines.find((l) => /^FN[:;]/i.test(l))?.replace(/^FN[^:]*:/i, "").trim();
  const phones = lines
    .filter((l) => /^(item\d+\.)?TEL[:;]/i.test(l))
    .map((l) => l.replace(/^[^:]*:/, "").trim())
    .filter(Boolean)
    .map((phone) => ({ phone }));
  const name = displayName ?? fn ?? "Contacto";
  return { name: { formatted_name: name, first_name: name }, phones };
}

/**
 * El contenido de un mensaje del dispositivo en la forma de Meta. null = un
 * tipo que no se registra (reacciones, encuestas, borrados, avisos internos).
 */
export function contentOf(message: Obj, keyId: string): Omit<WebhookMessage, "id" | "timestamp" | "from" | "to"> | null {
  const m = unwrap(message);
  const mediaId = `${DEVICE_MEDIA_PREFIX}${keyId}`;

  const text = str(m.conversation) ?? (isObj(m.extendedTextMessage) ? str(m.extendedTextMessage.text) : null);
  if (text) return { type: "text", text: { body: text } };

  const media = (key: string): Obj | null => (isObj(m[key]) ? (m[key] as Obj) : null);
  const image = media("imageMessage");
  if (image) return { type: "image", image: { id: mediaId, mime_type: str(image.mimetype) ?? undefined, caption: str(image.caption) ?? undefined } };
  const video = media("videoMessage") ?? media("ptvMessage");
  if (video) return { type: "video", video: { id: mediaId, mime_type: str(video.mimetype) ?? undefined, caption: str(video.caption) ?? undefined } };
  const audio = media("audioMessage");
  if (audio) return { type: "audio", audio: { id: mediaId, mime_type: str(audio.mimetype) ?? undefined, voice: audio.ptt === true } };
  const doc = media("documentMessage");
  if (doc)
    return {
      type: "document",
      document: {
        id: mediaId,
        mime_type: str(doc.mimetype) ?? undefined,
        filename: str(doc.fileName) ?? str(doc.title) ?? undefined,
        caption: str(doc.caption) ?? undefined,
      },
    };
  const sticker = media("stickerMessage");
  if (sticker) return { type: "sticker", sticker: { id: mediaId, mime_type: str(sticker.mimetype) ?? "image/webp" } };

  const loc = media("locationMessage") ?? media("liveLocationMessage");
  if (loc && typeof loc.degreesLatitude === "number" && typeof loc.degreesLongitude === "number") {
    return {
      type: "location",
      location: {
        latitude: loc.degreesLatitude,
        longitude: loc.degreesLongitude,
        name: str(loc.name) ?? undefined,
        address: str(loc.address) ?? undefined,
      },
    };
  }

  const contact = media("contactMessage");
  if (contact) return { type: "contacts", contacts: [contactFromVcard(str(contact.displayName), str(contact.vcard))] };
  const many = media("contactsArrayMessage");
  if (many && Array.isArray(many.contacts)) {
    const list = many.contacts.filter(isObj).map((c) => contactFromVcard(str(c.displayName), str(c.vcard)));
    if (list.length) return { type: "contacts", contacts: list };
  }

  // Respuesta a botones o listas: es lo que el contacto eligió, como texto.
  const choice =
    (isObj(m.buttonsResponseMessage) ? str(m.buttonsResponseMessage.selectedDisplayText) : null) ??
    (isObj(m.templateButtonReplyMessage) ? str(m.templateButtonReplyMessage.selectedDisplayText) : null) ??
    (isObj(m.listResponseMessage) ? str(m.listResponseMessage.title) : null);
  if (choice) return { type: "text", text: { body: choice } };

  return null;
}

/**
 * Los mensajes de un aviso `messages.upsert` del dispositivo, listos para la
 * ingesta. Tolerante: uno solo o en lista, con o sin `data`. Solo chats uno a
 * uno con contenido que se registra; lo demás se descarta sin error.
 */
export function parseDeviceMessages(data: unknown, now = new Date()): DeviceMessage[] {
  const items = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.messages) ? data.messages : [data];
  const out: DeviceMessage[] = [];
  for (const item of items) {
    if (!isObj(item) || !isObj(item.key) || !isObj(item.message)) continue;
    const key = item.key;
    const keyId = str(key.id);
    if (!keyId || keyId.length > MAX_ID) continue;
    if (!isPersonalChat(key.remoteJid)) continue;

    const main = addressOf(key.remoteJid);
    // Con `@lid`, el teléfono viene aparte (según la versión, uno u otro campo).
    const alt = [key.remoteJidAlt, key.senderPn, item.senderPn, key.participantPn].map(addressOf).find((a) => a.phone);
    const phone = main.phone ?? alt?.phone ?? null;
    const lid = main.lid ?? [key.remoteJidAlt, key.senderLid].map(addressOf).find((a) => a.lid)?.lid ?? null;
    if (!phone && !lid) continue;

    const content = contentOf(item.message, keyId);
    if (!content) continue;

    const fromMe = key.fromMe === true;
    const timestamp = secondsOf(item.messageTimestamp, now);
    out.push({
      keyId,
      fromMe,
      phone,
      lid,
      pushName: fromMe ? null : str(item.pushName),
      timestamp,
      message: {
        ...content,
        id: `${DEVICE_MESSAGE_PREFIX}${keyId}`,
        timestamp,
        ...(phone ? (fromMe ? { to: phone } : { from: phone }) : {}),
      } as WebhookMessage,
    });
  }
  return out;
}

/** El `key.id` del dispositivo de un `wa_media_id` (`direct:<id>`), o null si es de Meta. */
export function deviceMediaKeyId(waMediaId: string | null | undefined): string | null {
  if (!waMediaId?.startsWith(DEVICE_MEDIA_PREFIX)) return null;
  const id = waMediaId.slice(DEVICE_MEDIA_PREFIX.length);
  return id && id.length <= MAX_ID ? id : null;
}

/**
 * 046 — Un mensaje de un «Mi número» lleva el número en sus ids: el mismo
 * `key.id` lo ven los dos teléfonos de una conversación (la empresa y Ana,
 * o Ana y Luis), y `wa_message_id` es único en toda la base.
 */
export function numberMessageId(directNumberId: string, keyId: string): string {
  return `${DEVICE_MESSAGE_PREFIX}${directNumberId}.${keyId}`;
}

/** El `wa_media_id` de un adjunto de un «Mi número»: `dnum:<número>:<key.id>`. */
export function numberMediaId(directNumberId: string, keyId: string): string {
  return `${NUMBER_MEDIA_PREFIX}${directNumberId}:${keyId}`;
}

/** El número y el `key.id` de un `wa_media_id` de un «Mi número», o null. */
export function numberMediaRef(waMediaId: string | null | undefined): { directNumberId: string; keyId: string } | null {
  if (!waMediaId?.startsWith(NUMBER_MEDIA_PREFIX)) return null;
  const rest = waMediaId.slice(NUMBER_MEDIA_PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut <= 0) return null;
  const directNumberId = rest.slice(0, cut);
  const keyId = rest.slice(cut + 1);
  return keyId && keyId.length <= MAX_ID ? { directNumberId, keyId } : null;
}
