import { and, eq, ne } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { openWebhookSecret } from "./index";
import type { OpenFailure } from "./vault";

/**
 * Fase 3, PR 1 — Enrutamiento INVERSO: de un identificador que trae un
 * webhook (número, WABA, página, cuenta de Zernio) a la organización dueña.
 *
 * Es lo único de credenciales que usa el pool de SISTEMA (todavía no se sabe
 * de qué organización es el evento) y por eso NO descifra tokens: devuelve
 * la organización y nada secreto. El token se pide después, ya a nombre de
 * esa organización, con `getOrgCredentials`. Única excepción: el secreto
 * HMAC de Zernio, que hace falta para validar la firma antes de procesar.
 */

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

/**
 * Fase 3, PR 2: el estado de la organización viaja con la ruta. Si no está
 * `active`, quien enruta guarda el evento en `webhook_unrouted` (motivo
 * `org_suspended` / `org_deleted`) en vez de procesarlo.
 */
export type OrgState = "active" | "suspended" | "deleted";

export type WhatsAppRoute = {
  organizationId: string;
  wabaId: string;
  status: "connected" | "reconnect_required";
  orgStatus: OrgState;
};

/** `phone_number_id` → organización (webhook de mensajes, ecos y estados). */
export async function resolveWhatsAppNumber(phoneNumberId: string): Promise<WhatsAppRoute | null> {
  const [row] = await sys()
    .select({
      organizationId: schema.metaCredentials.organizationId,
      wabaId: schema.metaCredentials.wabaId,
      status: schema.metaCredentials.status,
      orgStatus: schema.organization.status,
    })
    .from(schema.metaCredentials)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.metaCredentials.organizationId))
    .where(eq(schema.metaCredentials.phoneNumberId, phoneNumberId))
    .limit(1);
  return row ?? null;
}

/**
 * H8 — `waba_id` → organización (eventos a nivel WABA, p. ej. plantillas).
 * `waba_id` es ÚNICO en `whatsapp_business_account`: no hay "la primera".
 */
export async function resolveWaba(wabaId: string): Promise<{ organizationId: string; orgStatus: OrgState } | null> {
  const [row] = await sys()
    .select({ organizationId: schema.whatsappBusinessAccount.organizationId, orgStatus: schema.organization.status })
    .from(schema.whatsappBusinessAccount)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.whatsappBusinessAccount.organizationId))
    .where(eq(schema.whatsappBusinessAccount.wabaId, wabaId))
    .limit(1);
  return row ?? null;
}

/**
 * H25 — ¿El número o la WABA ya son de OTRA organización? Se pregunta al
 * guardar la conexión manual, para responder 409 con un mensaje claro en vez
 * de un 500 por el índice único.
 */
export async function whatsappOwnedElsewhere(
  organizationId: string,
  phoneNumberId: string,
  wabaId: string
): Promise<{ phone: boolean; waba: boolean }> {
  const [phone] = await sys()
    .select({ id: schema.metaCredentials.id })
    .from(schema.metaCredentials)
    .where(
      and(
        eq(schema.metaCredentials.phoneNumberId, phoneNumberId),
        ne(schema.metaCredentials.organizationId, organizationId)
      )
    )
    .limit(1);
  const [waba] = await sys()
    .select({ id: schema.whatsappBusinessAccount.id })
    .from(schema.whatsappBusinessAccount)
    .where(
      and(
        eq(schema.whatsappBusinessAccount.wabaId, wabaId),
        ne(schema.whatsappBusinessAccount.organizationId, organizationId)
      )
    )
    .limit(1);
  return { phone: Boolean(phone), waba: Boolean(waba) };
}

export type ChannelRoute = { organizationId: string; source: "zernio" | "meta"; orgStatus: OrgState };

/** IG_ID del perfil (webhook de Meta) → organización. */
export async function resolveInstagramByIgUserId(igUserId: string): Promise<ChannelRoute | null> {
  const [row] = await sys()
    .select({ organizationId: schema.instagramCredentials.organizationId, source: schema.instagramCredentials.source, orgStatus: schema.organization.status })
    .from(schema.instagramCredentials)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.instagramCredentials.organizationId))
    .where(eq(schema.instagramCredentials.igUserId, igUserId))
    .limit(1);
  return row ?? null;
}

/** Cuenta de Zernio → organización (Instagram). */
export async function resolveInstagramByAccountRef(accountRef: string): Promise<ChannelRoute | null> {
  const [row] = await sys()
    .select({ organizationId: schema.instagramCredentials.organizationId, source: schema.instagramCredentials.source, orgStatus: schema.organization.status })
    .from(schema.instagramCredentials)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.instagramCredentials.organizationId))
    .where(eq(schema.instagramCredentials.accountRef, accountRef))
    .limit(1);
  return row ?? null;
}

/** Página de Facebook (webhook de Meta) → organización. */
export async function resolveMessengerByPageId(pageId: string): Promise<ChannelRoute | null> {
  const [row] = await sys()
    .select({ organizationId: schema.messengerCredentials.organizationId, source: schema.messengerCredentials.source, orgStatus: schema.organization.status })
    .from(schema.messengerCredentials)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.messengerCredentials.organizationId))
    .where(eq(schema.messengerCredentials.pageId, pageId))
    .limit(1);
  return row ?? null;
}

/** Cuenta de Zernio → organización (Messenger). */
export async function resolveMessengerByAccountRef(accountRef: string): Promise<ChannelRoute | null> {
  const [row] = await sys()
    .select({ organizationId: schema.messengerCredentials.organizationId, source: schema.messengerCredentials.source, orgStatus: schema.organization.status })
    .from(schema.messengerCredentials)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.messengerCredentials.organizationId))
    .where(eq(schema.messengerCredentials.accountRef, accountRef))
    .limit(1);
  return row ?? null;
}

export type ZernioSecret =
  | { ok: true; organizationId: string; secret: string | null }
  | { ok: false; error: "unknown_account" | OpenFailure };

/**
 * El secreto HMAC con que Zernio firma las entregas de esa cuenta. Se
 * necesita ANTES de procesar (para validar la firma), así que se resuelve con
 * el pool de sistema. `secret: null` = la cuenta no tiene secreto guardado:
 * la ruta rechaza el evento (Fase 3).
 */
export async function getZernioWebhookSecret(
  channel: "instagram" | "messenger",
  accountRef: string
): Promise<ZernioSecret> {
  const row =
    channel === "instagram"
      ? (
          await sys()
            .select()
            .from(schema.instagramCredentials)
            .where(eq(schema.instagramCredentials.accountRef, accountRef))
            .limit(1)
        )[0]
      : (
          await sys()
            .select()
            .from(schema.messengerCredentials)
            .where(eq(schema.messengerCredentials.accountRef, accountRef))
            .limit(1)
        )[0];
  if (!row) return { ok: false, error: "unknown_account" };
  const opened = openWebhookSecret(row);
  if (!opened.ok) return { ok: false, error: opened.error };
  return { ok: true, organizationId: row.organizationId, secret: opened.value };
}
