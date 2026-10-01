import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Autenticación en dos capas del webhook (contrato webhook.md / DV-VC-02).
 * Este módulo es puro (sin BD) para poder testearse unitariamente.
 */

/** Comparación timing-safe de strings de longitud arbitraria. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "cmp").update(a).digest();
  const hb = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Capa 1: el segmento de la ruta debe coincidir con el verify token. */
export function isValidWebhookToken(
  segment: string,
  verifyToken: string
): boolean {
  return verifyToken.length > 0 && safeEqual(segment, verifyToken);
}

/**
 * Capa 2: firma HMAC-SHA256 de Meta sobre el body CRUDO.
 * Con META_APP_SECRET definido se EXIGE: sin header o con firma inválida →
 * false (la ruta responde 401). Sin secreto devuelve true: por eso NINGUNA
 * ruta la usa directo; WhatsApp, Instagram y Messenger pasan por
 * `checkMetaSignature` (H7 + Fase 3), que sin secreto rechaza.
 */
export function isValidSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined
): boolean {
  if (!appSecret) return true;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  return safeEqual(signatureHeader.slice("sha256=".length), expected);
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "missing_secret" | "bad_signature" };

/**
 * H7 — Firma del webhook de WhatsApp, OBLIGATORIA.
 *
 * - Con META_APP_SECRET: se verifica siempre (sin firma o inválida → rechazo).
 * - Sin META_APP_SECRET: se rechaza todo evento (`missing_secret`). La URL
 *   secreta sola no basta: quien la conozca inyectaría mensajes falsos para
 *   cualquier número de la instancia.
 * - Única salida: `allowUnsignedDev`, que la ruta enciende SOLO con
 *   `isMockEnabled()` (WA_MOCK_ENABLED=true y NODE_ENV ≠ production), para
 *   el desarrollo y los E2E con el wa-mock. En producción jamás aplica.
 */
export function checkWhatsAppSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined,
  opts: { allowUnsignedDev: boolean }
): SignatureCheck {
  if (!appSecret) {
    return opts.allowUnsignedDev
      ? { ok: true }
      : { ok: false, reason: "missing_secret" };
  }
  return isValidSignature(rawBody, signatureHeader, appSecret)
    ? { ok: true }
    : { ok: false, reason: "bad_signature" };
}

/**
 * Fase 3: la misma regla para TODO lo que firma Meta (WhatsApp, Instagram,
 * Messenger): una sola app de Meta, un solo App Secret, firma obligatoria.
 */
export const checkMetaSignature = checkWhatsAppSignature;

/** Aviso cuando se rechaza un evento por falta de META_APP_SECRET. Sin valores. */
export const MISSING_SECRET_REJECT_WARNING =
  "[webhook] Evento de WhatsApp rechazado (401): META_APP_SECRET no está definido y en producción la firma " +
  "x-hub-signature-256 es obligatoria. Define META_APP_SECRET (App Secret de tu app de Meta: Configuración de " +
  "la app → Básica) en las variables de la plataforma y reinicia; mientras tanto NO entra ningún mensaje.";

/**
 * Advertencia de arranque cuando falta META_APP_SECRET. null si está
 * definido. Nunca incluye valores de variables. Solo avisa: el arranque NO
 * falla (el resto del CRM funciona), pero el webhook de WhatsApp rechaza los
 * eventos hasta que se defina — salvo en desarrollo con los mocks.
 */
export function unsignedWebhookWarning(
  appSecret: string | undefined,
  mockEnabled = false
): string | null {
  if (appSecret) return null;
  if (mockEnabled) {
    return (
      "[boot] META_APP_SECRET no está definido: la firma x-hub-signature-256 NO se verifica. Solo se aceptan " +
      "eventos sin firma porque WA_MOCK_ENABLED=true fuera de producción (desarrollo / E2E). En producción el " +
      "webhook de WhatsApp los rechaza con 401."
    );
  }
  return (
    "[boot] META_APP_SECRET no está definido: la firma x-hub-signature-256 de los webhooks de Meta NO se verifica " +
    "y el webhook de WhatsApp RECHAZA todos los eventos (401): no entrará ningún mensaje. Define META_APP_SECRET " +
    "(App Secret de tu app de Meta: Configuración de la app → Básica) y reinicia."
  );
}

/* ---------- Tipos del payload de Meta (subconjunto soportado) ---------- */

/** Payload de un adjunto en un mensaje del webhook (008). */
export type WebhookMediaPayload = {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  /** Solo documentos. */
  filename?: string;
  /** Solo audio: true si es nota de voz. */
  voice?: boolean;
};

export type WebhookLocation = {
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
};

/**
 * 016 — Objeto `referral`: SOLO llega cuando el mensaje viene de un anuncio
 * Click-to-WhatsApp, y normalmente solo en el PRIMER mensaje de la
 * conversación. Su `ctwa_clid` es lo que permite devolverle a Meta el
 * desenlace de ese lead; el resto son datos del creativo.
 */
export type WebhookReferral = {
  source_url?: string;
  source_id?: string;
  source_type?: string;
  headline?: string;
  body?: string;
  media_type?: string;
  image_url?: string;
  video_url?: string;
  thumbnail_url?: string;
  ctwa_clid?: string;
};

export type WebhookMessage = {
  /** Teléfono del remitente. OPCIONAL desde la migración de Meta a BSUID (003). */
  from?: string;
  /** Business-Scoped User ID del remitente cuando no hay teléfono (003). */
  from_user_id?: string;
  /** Destinatario — presente en echoes de coexistence (008): el wa_id del lead. */
  to?: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: WebhookMediaPayload;
  video?: WebhookMediaPayload;
  audio?: WebhookMediaPayload;
  document?: WebhookMediaPayload;
  sticker?: WebhookMediaPayload;
  location?: WebhookLocation;
  contacts?: unknown[];
  /** 016: origen del anuncio, cuando la conversación nació de uno. */
  referral?: WebhookReferral;
};

export type WebhookStatus = {
  id: string;
  status: string;
  timestamp: string;
  recipient_id?: string;
  errors?: { code: number; title?: string; message?: string }[];
};

export type WebhookValue = {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string; user_id?: string }[];
  messages?: WebhookMessage[];
  /** Echoes de coexistence (008): mensajes enviados desde la app del teléfono. */
  message_echoes?: WebhookMessage[];
  statuses?: WebhookStatus[];
  // message_template_status_update
  event?: string;
  message_template_name?: string;
  message_template_language?: string;
  message_template_id?: number | string;
  reason?: string | null;
};

export type WebhookChange = { field?: string; value?: WebhookValue };

export type WebhookPayload = {
  object?: string;
  entry?: { id?: string; changes?: WebhookChange[] }[];
};
