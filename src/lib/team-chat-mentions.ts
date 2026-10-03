/**
 * 026 — Menciones de chats de CLIENTE dentro del chat de equipo. Puras (sin
 * BD): las prueba tests/unit/team-chat-mentions.test.ts.
 *
 * En la BD el texto guarda el marcador `@[chat:<conversationId>]` y
 * `mentions` guarda solo ids: el nombre del cliente NUNCA se guarda. Al leer,
 * cada mención se resuelve POR QUIEN LEE (con `scopedContacts`):
 *  - si puede ver ese chat → `{ accessible: true, contactId, label }`;
 *  - si no → `{ accessible: false }` y nada más (criterio 404: ni el id).
 * El texto que recibe el cliente lleva marcadores por POSICIÓN (`@[m:0]`),
 * nunca el id original: así un id tampoco se cuela por el texto.
 *
 * Menciones de COMPAÑEROS (`@[user:<userId>]`): solo de quien puede leer el
 * hilo (Avisos: todo el equipo; directo/grupo: sus participantes), así que el
 * aviso le llega con el globo de no leídos de siempre. Su nombre no es dato
 * de clientes: lo ve cualquiera del hilo.
 */

/** Marcador guardado. El id es un nanoid con prefijo (`cv_…`). */
export const MENTION_TOKEN = /@\[chat:([a-z0-9_]{1,64})\]/g;
/** Marcador guardado de un compañero (ids de Better Auth: alfanuméricos). */
export const USER_MENTION_TOKEN = /@\[user:([A-Za-z0-9_-]{1,64})\]/g;
/** Cualquier marcador guardado (chat o compañero), en orden de aparición. */
const ANY_TOKEN = /@\[(chat|user):([A-Za-z0-9_-]{1,64})\]/g;
/** Marcador que viaja al cliente (por posición en `mentions`). */
export const MENTION_SLOT = /@\[m:(\d{1,2})\]/g;
/** Tope de menciones por mensaje. */
export const MENTIONS_MAX = 10;

export type MentionDto =
  | { accessible: true; kind?: "chat"; conversationId: string; contactId: string; label: string }
  | { accessible: true; kind: "user"; userId: string; label: string }
  | { accessible: false };

export const mentionToken = (conversationId: string) => `@[chat:${conversationId}]`;
export const userMentionToken = (userId: string) => `@[user:${userId}]`;
/** En el mapa del editor, un compañero va como `user:<id>` (un chat, con su id a secas). */
export const userMentionRef = (userId: string) => `user:${userId}`;

/** Ids mencionados, sin repetir, en orden de aparición. */
export function extractMentionIds(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(MENTION_TOKEN)) {
    if (m[1] && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Compañeros mencionados, sin repetir, en orden de aparición. */
export function extractUserMentionIds(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(USER_MENTION_TOKEN)) {
    if (m[1] && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Todas las menciones (`chat:<id>` / `user:<id>`), sin repetir, en orden. */
function mentionKeys(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(ANY_TOKEN)) {
    // Un chat solo con el formato de nanoid (minúsculas), como siempre.
    if (m[1] === "chat" && !/^[a-z0-9_]+$/.test(m[2] ?? "")) continue;
    const key = `${m[1]}:${m[2]}`;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * El texto para UNA persona: cada marcador guardado pasa a `@[m:i]` y
 * `mentions[i]` dice qué ve ella. `resolved` trae solo los chats que ESA
 * persona puede ver; lo demás sale como `{ accessible: false }`.
 */
export function renderMentions(
  body: string,
  resolved: ReadonlyMap<string, { contactId: string; label: string }>,
  people: ReadonlyMap<string, string> = new Map()
): { body: string; mentions: MentionDto[] } {
  const order = mentionKeys(body);
  const mentions: MentionDto[] = order.map((key) => {
    const id = key.slice(key.indexOf(":") + 1);
    if (key.startsWith("user:")) {
      const label = people.get(id);
      return label ? { accessible: true, kind: "user", userId: id, label } : { accessible: false };
    }
    const r = resolved.get(id);
    return r ? { accessible: true, conversationId: id, contactId: r.contactId, label: r.label } : { accessible: false };
  });
  const out = body.replace(ANY_TOKEN, (whole, kind: string, id: string) => {
    const i = order.indexOf(`${kind}:${id}`);
    return i < 0 ? whole : `@[m:${i}]`;
  });
  return { body: out, mentions };
}

/** Texto de vista previa (lista de hilos): la mención sin id ni nombre. */
export function previewWithoutMentions(body: string): string {
  return body
    .replace(MENTION_TOKEN, "@chat")
    .replace(USER_MENTION_TOKEN, "@compañero")
    .replace(MENTION_SLOT, "@chat");
}

/** Para pintar: el texto partido en trozos de texto y menciones. */
export type BodyPart = { type: "text"; text: string } | { type: "mention"; mention: MentionDto };

export function splitBody(body: string, mentions: readonly MentionDto[]): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_SLOT)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ type: "text", text: body.slice(last, idx) });
    const mention = mentions[Number(m[1])] ?? { accessible: false };
    parts.push({ type: "mention", mention });
    last = idx + m[0].length;
  }
  if (last < body.length) parts.push({ type: "text", text: body.slice(last) });
  return parts;
}

/**
 * Editor: el texto que escribe la persona usa `@{Nombre}` (legible) y un mapa
 * nombre → conversación (o `user:<id>` para un compañero). Antes de enviar se
 * vuelve marcador guardado.
 */
export function encodeMentions(text: string, picked: ReadonlyMap<string, string>): string {
  let out = text;
  for (const [label, ref] of picked) {
    const token = ref.startsWith("user:") ? userMentionToken(ref.slice(5)) : mentionToken(ref);
    out = out.split(`@{${label}}`).join(token);
  }
  return out;
}
