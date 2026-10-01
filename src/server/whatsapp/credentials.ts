import { and, notInArray } from "drizzle-orm";
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
 */
export async function getCredentialsByOrg(
  organizationId: string
): Promise<Credentials | null> {
  return getOrgCredentialsOrNull(organizationId, "whatsapp");
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
    await db
      .insert(schema.metaCredentials)
      .values({ id: newId("credentials"), organizationId: input.organizationId, ...cred })
      .onConflictDoUpdate({
        target: [schema.metaCredentials.organizationId],
        set: { ...cred, updatedAt: new Date() },
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

/** Marca la conexión como vencida (token inválido detectado en runtime). */
export async function markReconnectRequired(
  organizationId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.metaCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.metaCredentials.organizationId, organizationId));
}

/** Últimos 4 caracteres del token para mostrar en UI (jamás el token). */
export function tokenLast4(token: string): string {
  return token.slice(-4);
}
