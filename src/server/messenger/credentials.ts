import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { newId } from "@/lib/db/ids";
import {
  getOrgCredentialsOrNull,
  sealForStorage,
  type MessengerCredentials,
} from "@/server/credentials";

/**
 * 017 — Credenciales del canal de Messenger.
 *
 * Dos fuentes, como en Instagram: la API unificada de Zernio (una llave, y el
 * enrutado por `accountRef`) o una app propia de Meta (token de la página, y
 * el enrutado por `pageId`). El token viaja descifrado solo en memoria y nunca
 * sale en una respuesta de la API — hacia fuera se expone su cola.
 */

export type { MessengerCredentials };

/**
 * La conexión de la organización, o null. Leer y descifrar es de la puerta
 * única (`src/server/credentials/`); el enrutamiento del webhook (perfil,
 * página o cuenta de Zernio → organización) está en
 * `src/server/credentials/resolve.ts`.
 */
export async function getMessengerCredentialsByOrg(
  organizationId: string
): Promise<MessengerCredentials | null> {
  return getOrgCredentialsOrNull(organizationId, "messenger");
}

export async function saveMessengerCredentials(input: {
  organizationId: string;
  source: "zernio" | "meta";
  pageId: string | null;
  pageName: string | null;
  accountRef: string | null;
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
    .select({ id: schema.messengerCredentials.id })
    .from(schema.messengerCredentials)
    .where(scoped(schema.messengerCredentials.organizationId, input.organizationId))
    .limit(1);

  const values = {
    organizationId: input.organizationId,
    source: input.source,
    pageId: input.pageId,
    pageName: input.pageName,
    accountRef: input.accountRef,
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
      .update(schema.messengerCredentials)
      .set(values)
      .where(eq(schema.messengerCredentials.id, existing.id));
    return;
  }
  await db
    .insert(schema.messengerCredentials)
    .values({ id: newId("credentials"), ...values });
}

/** El token murió: se pausan los envíos y la UI pide reconectar. */
export async function markMessengerReconnectRequired(
  organizationId: string
): Promise<void> {
  await getDb()
    .update(schema.messengerCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.messengerCredentials.organizationId, organizationId));
}

export function tokenLast4(token: string): string {
  return token.slice(-4);
}
