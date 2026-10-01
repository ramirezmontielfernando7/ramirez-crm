import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import {
  getOrgCredentialsOrNull,
  sealForStorage,
  type InstagramCredentials,
} from "@/server/credentials";

/**
 * 014 — Credenciales del canal de Instagram.
 *
 * Mismo contrato que las de WhatsApp (`server/whatsapp/credentials.ts`): el
 * token viaja descifrado solo en memoria y nunca sale en una respuesta de la
 * API — hacia fuera se expone únicamente su cola.
 */

export type { InstagramCredentials };

/**
 * La conexión de la organización, o null. Leer y descifrar es de la puerta
 * única (`src/server/credentials/`); el enrutamiento del webhook (perfil,
 * página o cuenta de Zernio → organización) está en
 * `src/server/credentials/resolve.ts`.
 */
export async function getInstagramCredentialsByOrg(
  organizationId: string
): Promise<InstagramCredentials | null> {
  return getOrgCredentialsOrNull(organizationId, "instagram");
}

export async function saveInstagramCredentials(input: {
  organizationId: string;
  source: "zernio" | "meta";
  igUserId: string;
  accountRef: string | null;
  username: string | null;
  token: string;
  webhookSecret: string | null;
}): Promise<void> {
  const db = getDb();
  const enc = sealForStorage(input.token);
  // El secreto HMAC de Zernio también va cifrado (Fase 3, PR 1), con la
  // MISMA versión de llave que el token: la fila tiene una sola.
  const secret = input.webhookSecret ? sealForStorage(input.webhookSecret) : null;
  // Solo el id: no hace falta descifrar para reemplazar (y con una llave
  // perdida, volver a guardar es justo como se arregla).
  const [existing] = await db
    .select({ id: schema.instagramCredentials.id })
    .from(schema.instagramCredentials)
    .where(scoped(schema.instagramCredentials.organizationId, input.organizationId))
    .limit(1);

  const values = {
    organizationId: input.organizationId,
    source: input.source,
    igUserId: input.igUserId,
    accountRef: input.accountRef,
    username: input.username,
    tokenCipher: enc.cipher,
    tokenIv: enc.iv,
    tokenTag: enc.tag,
    keyVersion: enc.keyVersion,
    webhookSecret: null,
    webhookSecretCipher: secret?.cipher ?? null,
    webhookSecretIv: secret?.iv ?? null,
    webhookSecretTag: secret?.tag ?? null,
    status: "connected" as const,
    updatedAt: new Date(),
  };

  if (existing) {
    await db
      .update(schema.instagramCredentials)
      .set(values)
      .where(eq(schema.instagramCredentials.id, existing.id));
    return;
  }
  await db
    .insert(schema.instagramCredentials)
    .values({ id: newId("credentials"), ...values });
}

/** El token murió: se pausan los envíos y la UI pide reconectar. */
export async function markInstagramReconnectRequired(
  organizationId: string
): Promise<void> {
  await getDb()
    .update(schema.instagramCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.instagramCredentials.organizationId, organizationId));
}

export function tokenLast4(token: string): string {
  return token.slice(-4);
}
