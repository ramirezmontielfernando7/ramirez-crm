import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { platformOrgId } from "@/server/platform";
import { logger } from "@/lib/log";

const log = logger("bot");

/**
 * Fase 1 multitenant (H2) — llaves del cerebro externo, una organización por
 * llave. Ver `bot_api_key` en schema.ts.
 *
 * Formato: `vbk_` + 32 bytes aleatorios en base64url. Se guarda el SHA-256;
 * la llave en claro solo existe al crearla (se imprime una vez).
 */

export const BOT_KEY_PREFIX = "vbk_";
/** Una llave más corta que esto no se busca (igual que antes con la env). */
export const MIN_KEY_LENGTH = 16;

export function hashBotKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateBotKey(): string {
  return BOT_KEY_PREFIX + randomBytes(32).toString("base64url");
}

/** Lo que se muestra de una llave: nunca más que el principio. */
export function botKeyPrefix(key: string): string {
  return key.slice(0, 8);
}

/**
 * La organización de una llave activa, o `null`. Búsqueda por hash exacto
 * (índice único): no hay comparación carácter a carácter que medir con el
 * tiempo de respuesta.
 */
export async function resolveBotKey(
  provided: string | null
): Promise<{ keyId: string; organizationId: string } | null> {
  if (!provided || provided.length < MIN_KEY_LENGTH) return null;
  const rows = await getDb()
    .select({ id: schema.botApiKey.id, organizationId: schema.botApiKey.organizationId })
    .from(schema.botApiKey)
    .where(and(eq(schema.botApiKey.keyHash, hashBotKey(provided)), isNull(schema.botApiKey.revokedAt)))
    .limit(1);
  return rows[0] ? { keyId: rows[0].id, organizationId: rows[0].organizationId } : null;
}

/** ¿Esta organización tiene alguna llave activa? (tarjeta «Quién responde»). */
export async function hasActiveBotKey(organizationId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.botApiKey.id })
    .from(schema.botApiKey)
    .where(scoped(schema.botApiKey.organizationId, organizationId, isNull(schema.botApiKey.revokedAt)))
    .limit(1);
  return rows.length > 0;
}

/**
 * `last_used_at` como mucho una vez por minuto por llave: el cerebro hace
 * varias llamadas por turno y no hace falta una escritura en cada una.
 */
const LAST_USED_EVERY_MS = 60_000;
const globalForKeys = globalThis as unknown as { __voceroBotKeyTouched?: Map<string, number> };

export async function touchBotKey(keyId: string, organizationId: string, now = Date.now()): Promise<void> {
  const touched = (globalForKeys.__voceroBotKeyTouched ??= new Map());
  const last = touched.get(keyId) ?? 0;
  if (now - last < LAST_USED_EVERY_MS) return;
  touched.set(keyId, now);
  try {
    await getDb()
      .update(schema.botApiKey)
      .set({ lastUsedAt: new Date(now) })
      .where(scoped(schema.botApiKey.organizationId, organizationId, eq(schema.botApiKey.id, keyId)));
  } catch (err) {
    // Solo es un dato de diagnóstico: no se tumba la llamada del cerebro.
    log.error("no se pudo anotar el uso de la llave", { org: organizationId, err });
  }
}

/**
 * Al arrancar: la `BOT_API_KEY` de la variable de entorno queda ligada a
 * `PLATFORM_ORG_ID` (y solo a ella). Idempotente. Si la variable cambió, la
 * llave vieja de origen `env` se revoca. Sin `PLATFORM_ORG_ID`, la variable
 * no abre nada y se avisa en el log. Nunca lanza: el CRM arranca igual.
 */
export async function syncEnvBotKey(): Promise<void> {
  const key = process.env.BOT_API_KEY?.trim();
  const orgId = platformOrgId();
  try {
    const db = getDb();
    if (!key || key.length < MIN_KEY_LENGTH) {
      if (key) log.warn("BOT_API_KEY es demasiado corta (mínimo 16): no abre /api/bot/*");
      // Sin llave en la variable: ninguna llave de origen env sigue activa.
      await db
        .update(schema.botApiKey)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.botApiKey.source, "env"), isNull(schema.botApiKey.revokedAt)));
      return;
    }
    if (!orgId) {
      log.warn(
        "BOT_API_KEY está definida pero PLATFORM_ORG_ID no: la llave no abre /api/bot/* para ninguna organización. " +
          "Define PLATFORM_ORG_ID con el id de tu organización (org_…)."
      );
      return;
    }
    const [org] = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.id, orgId))
      .limit(1);
    if (!org) {
      log.warn("PLATFORM_ORG_ID no existe en la base: la BOT_API_KEY no abre nada", { platformOrgId: orgId });
      return;
    }
    const hash = hashBotKey(key);
    await db.transaction(async (tx) => {
      // La llave anterior de la variable (si cambió) deja de valer.
      await tx
        .update(schema.botApiKey)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.botApiKey.source, "env"), ne(schema.botApiKey.keyHash, hash), isNull(schema.botApiKey.revokedAt)));
      const [actual] = await tx
        .select({ id: schema.botApiKey.id, organizationId: schema.botApiKey.organizationId, revokedAt: schema.botApiKey.revokedAt })
        .from(schema.botApiKey)
        .where(eq(schema.botApiKey.keyHash, hash))
        .limit(1);
      if (!actual) {
        await tx.insert(schema.botApiKey).values({
          id: newId("botApiKey"),
          organizationId: orgId,
          name: "BOT_API_KEY (variable de entorno)",
          keyPrefix: botKeyPrefix(key),
          keyHash: hash,
          source: "env",
        });
      } else if (actual.organizationId !== orgId || actual.revokedAt) {
        // Cambió PLATFORM_ORG_ID (o se había revocado): la llave pasa a la
        // organización de la plataforma, y solo a ella.
        await tx
          .update(schema.botApiKey)
          .set({ organizationId: orgId, revokedAt: null, source: "env" })
          .where(eq(schema.botApiKey.id, actual.id));
      }
    });
  } catch (err) {
    log.error("no se pudo ligar BOT_API_KEY a PLATFORM_ORG_ID", { err });
  }
}
