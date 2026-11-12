import { and, asc, eq, notInArray } from "drizzle-orm";
import { getDb, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { isMockEnabled } from "@/lib/env";
import {
  getOrgCredentialsOrNull,
  sealForStorage,
  type WhatsAppCredentials,
} from "@/server/credentials";

/**
 * Conexión de WhatsApp de una organización. Leer y descifrar es de la puerta
 * única (`src/server/credentials/`); aquí quedan guardar y marcar estados.
 * El enrutamiento del webhook (número/WABA → organización) está en
 * `src/server/credentials/resolve.ts`.
 */

export type Credentials = WhatsAppCredentials;

/**
 * La conexión de la organización, o null si no tiene. Lanza
 * `CredentialUnavailableError` (tipada) si existe pero no se puede descifrar.
 *
 * 0080: con varios números, sin `phoneNumberId` (o si ese número ya no existe)
 * devuelve el PRINCIPAL (el más antiguo); con él, el de ese número.
 */
export async function getCredentialsByOrg(
  organizationId: string,
  phoneNumberId?: string | null
): Promise<Credentials | null> {
  return getOrgCredentialsOrNull(organizationId, "whatsapp", { phoneNumberId });
}

/** Largo máximo del nombre que la empresa le pone a un número. */
const LABEL_MAX = 40;

/** Nombre del número: sin espacios de más; vacío = sin nombre (null). */
export function normalizeNumberLabel(raw: string | null | undefined): string | null {
  const v = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX);
  return v === "" ? null : v;
}

/**
 * H8: los IDs de Meta (WABA y número) son solo dígitos. Con los mocks fuera
 * de producción se acepta además un id simple (`WABA-E2E`, `PN-E2E`…), que
 * es lo que usan los guiones E2E. La validación de fondo es la de Meta
 * (`verifyPhoneInWaba`, H25).
 */
function isValidMetaId(value: string): boolean {
  if (/^\d{5,25}$/.test(value)) return true;
  return isMockEnabled() && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function isValidWabaId(wabaId: string): boolean {
  return isValidMetaId(wabaId);
}

export function isValidPhoneNumberId(phoneNumberId: string): boolean {
  return isValidMetaId(phoneNumberId);
}

/**
 * Guarda (o reemplaza) la conexión. En UNA transacción: la WABA queda
 * registrada como de esta organización (H8; si es de otra, el índice único lo
 * impide) y el número cuelga de ella. Una WABA anterior que ya no use ningún
 * número de la organización se suelta.
 */
export async function saveCredentials(input: {
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  token: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
  /** 0080: el nombre del número; al reconectar sin él se conserva el que tenía. */
  label?: string | null;
}): Promise<void> {
  const sealed = sealForStorage(input.token);
  await withTenant(input.organizationId, async (db) => {
    await db
      .insert(schema.whatsappBusinessAccount)
      .values({
        id: newId("whatsappBusinessAccount"),
        organizationId: input.organizationId,
        wabaId: input.wabaId,
      })
      .onConflictDoNothing({ target: [schema.whatsappBusinessAccount.wabaId] });

    const cred = {
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      displayPhoneNumber: input.displayPhoneNumber ?? null,
      verifiedName: input.verifiedName ?? null,
      tokenCipher: sealed.cipher,
      tokenIv: sealed.iv,
      tokenTag: sealed.tag,
      keyVersion: sealed.keyVersion,
      status: "connected" as const,
    };
    const label = normalizeNumberLabel(input.label);
    // 0080: VARIOS números por organización. Volver a guardar el mismo número
    // lo reconecta (nuevo token); uno distinto se AGREGA. Si el número es de
    // OTRA organización no se toca (el `where` lo impide y el índice único lo
    // reporta como 23505).
    await db
      .insert(schema.metaCredentials)
      .values({ id: newId("credentials"), organizationId: input.organizationId, ...cred, label })
      .onConflictDoUpdate({
        target: [schema.metaCredentials.phoneNumberId],
        set: { ...cred, ...(label !== null ? { label } : {}), updatedAt: new Date() },
        setWhere: eq(schema.metaCredentials.organizationId, input.organizationId),
      });

    // WABAs de la organización que ya no usa ningún número: se sueltan.
    const enUso = db
      .select({ wabaId: schema.metaCredentials.wabaId })
      .from(schema.metaCredentials)
      .where(scoped(schema.metaCredentials.organizationId, input.organizationId));
    await db
      .delete(schema.whatsappBusinessAccount)
      .where(
        and(
          scoped(schema.whatsappBusinessAccount.organizationId, input.organizationId),
          notInArray(schema.whatsappBusinessAccount.wabaId, enUso)
        )
      );
  });
}

/**
 * Marca la conexión como vencida (token inválido detectado en runtime).
 * 0080: con `phoneNumberId` solo ese número; sin él, todos los de la
 * organización (un token de la plataforma vencido afecta a todos).
 */
export async function markReconnectRequired(
  organizationId: string,
  phoneNumberId?: string | null
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.metaCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(
      scoped(
        schema.metaCredentials.organizationId,
        organizationId,
        phoneNumberId ? eq(schema.metaCredentials.phoneNumberId, phoneNumberId) : undefined
      )
    );
}

/**
 * 0080 — Cambia el nombre de un número de la organización. Devuelve false si
 * el número no es de ella.
 */
export async function setNumberLabel(
  organizationId: string,
  phoneNumberId: string,
  label: string | null
): Promise<boolean> {
  const rows = await getDb()
    .update(schema.metaCredentials)
    .set({ label: normalizeNumberLabel(label), updatedAt: new Date() })
    .where(
      scoped(
        schema.metaCredentials.organizationId,
        organizationId,
        eq(schema.metaCredentials.phoneNumberId, phoneNumberId)
      )
    )
    .returning({ id: schema.metaCredentials.id });
  return rows.length > 0;
}

/**
 * 0080 — Quita un número. Sus chats pasan a hablar por el principal. Devuelve false si no
 * es de la organización. La WABA que ya no use ningún número se suelta.
 */
export async function removeNumber(organizationId: string, phoneNumberId: string): Promise<boolean> {
  return withTenant(organizationId, async (db) => {
    const gone = await db
      .delete(schema.metaCredentials)
      .where(
        scoped(
          schema.metaCredentials.organizationId,
          organizationId,
          eq(schema.metaCredentials.phoneNumberId, phoneNumberId)
        )
      )
      .returning({ id: schema.metaCredentials.id });
    if (gone.length === 0) return false;
    // Sus chats pasan al principal (el más antiguo que queda); sin ninguno, NULL.
    const [principal] = await db
      .select({ phoneNumberId: schema.metaCredentials.phoneNumberId })
      .from(schema.metaCredentials)
      .where(scoped(schema.metaCredentials.organizationId, organizationId))
      .orderBy(asc(schema.metaCredentials.createdAt), asc(schema.metaCredentials.id))
      .limit(1);
    await db
      .update(schema.conversation)
      .set({ waPhoneNumberId: principal?.phoneNumberId ?? null })
      .where(scoped(schema.conversation.organizationId, organizationId, eq(schema.conversation.waPhoneNumberId, phoneNumberId)));
    const enUso = db
      .select({ wabaId: schema.metaCredentials.wabaId })
      .from(schema.metaCredentials)
      .where(scoped(schema.metaCredentials.organizationId, organizationId));
    await db
      .delete(schema.whatsappBusinessAccount)
      .where(
        and(
          scoped(schema.whatsappBusinessAccount.organizationId, organizationId),
          notInArray(schema.whatsappBusinessAccount.wabaId, enUso)
        )
      );
    return true;
  });
}

/** Últimos 4 caracteres del token para mostrar en UI (jamás el token). */
export function tokenLast4(token: string): string {
  return token.slice(-4);
}
