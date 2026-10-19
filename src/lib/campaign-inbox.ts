/**
 * 041 — Reglas puras de los chats de campaña en la Bandeja. Sin React ni BD.
 *
 * Un chat que inició una campaña masiva y que el contacto aún no responde
 * («pendiente») vive en la pestaña «Campañas»: fuera de la principal, sin
 * contar como no leído y sin avisos en vivo. El primer entrante lo regresa a
 * la principal con «Respondió a campaña X».
 */

/** Qué lista pide la Bandeja: la principal o la pestaña «Campañas». */
export type InboxView = "main" | "campaigns";

export function parseInboxView(value: string | null | undefined): InboxView {
  return value === "campaigns" ? "campaigns" : "main";
}

/**
 * ¿El envío de una campaña deja el chat como «pendiente»? Solo si el contacto
 * NUNCA ha escrito: una conversación con entrantes previos sigue en la
 * principal aunque reciba campañas (no se esconde lo que alguien atiende).
 * Las del Laboratorio jamás (las campañas no les envían, pero por si acaso).
 */
export function campaignKeepsPending(c: { lastInboundAt: Date | string | null; isTest: boolean }): boolean {
  return !c.isTest && c.lastInboundAt == null;
}

/** ¿En qué lista cae? */
export function inboxViewOf(c: { campaignPendingId: string | null }): InboxView {
  return c.campaignPendingId ? "campaigns" : "main";
}

/** Texto de la marca de la fila. Sin nombre (campaña borrada): genérico. */
export function campaignReplyLabel(name: string | null | undefined): string {
  const n = name?.trim();
  return n ? `Respondió a campaña ${n}` : "Respondió a una campaña";
}

/** Texto de la marca en la pestaña «Campañas». */
export function campaignPendingLabel(name: string | null | undefined): string {
  const n = name?.trim();
  return n ? `Campaña ${n} · sin respuesta` : "Campaña · sin respuesta";
}
