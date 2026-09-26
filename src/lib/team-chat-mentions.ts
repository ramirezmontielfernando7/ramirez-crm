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
 */

/** Marcador guardado. El id es un nanoid con prefijo (`cv_…`). */
export const MENTION_TOKEN = /@\[chat:([a-z0-9_]{1,64})\]/g;
/** Marcador que viaja al cliente (por posición en `mentions`). */
export const MENTION_SLOT = /@\[m:(\d{1,2})\]/g;
/** Tope de menciones por mensaje. */
export const MENTIONS_MAX = 10;

export type MentionDto =
  | { accessible: true; conversationId: string; contactId: string; label: string }
  | { accessible: false };

export const mentionToken = (conversationId: string) => `@[chat:${conversationId}]`;

/** Ids mencionados, sin repetir, en orden de aparición. */
export function extractMentionIds(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(MENTION_TOKEN)) {
    if (m[1] && !out.includes(m[1])) out.push(m[1]);
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
  resolved: ReadonlyMap<string, { contactId: string; label: string }>
): { body: string; mentions: MentionDto[] } {
  const order = extractMentionIds(body);
  const mentions: MentionDto[] = order.map((id) => {
    const r = resolved.get(id);
    return r ? { accessible: true, conversationId: id, contactId: r.contactId, label: r.label } : { accessible: false };
  });
  const out = body.replace(MENTION_TOKEN, (_m, id: string) => `@[m:${order.indexOf(id)}]`);
  return { body: out, mentions };
}

/** Texto de vista previa (lista de hilos): la mención sin id ni nombre. */
export function previewWithoutMentions(body: string): string {
  return body.replace(MENTION_TOKEN, "@chat").replace(MENTION_SLOT, "@chat");
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
 * nombre → conversación. Antes de enviar se vuelve marcador guardado.
 */
export function encodeMentions(text: string, picked: ReadonlyMap<string, string>): string {
  let out = text;
  for (const [label, conversationId] of picked) {
    out = out.split(`@{${label}}`).join(mentionToken(conversationId));
  }
  return out;
}
