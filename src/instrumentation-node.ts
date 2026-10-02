import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { getEnv, isMockEnabled } from "@/lib/env";
import { unsignedWebhookWarning } from "@/server/inbox/webhook";
import { logger } from "@/lib/log";

const log = logger("boot");

/**
 * 008 — Aviso al arranque si MEDIA_DIR no es escribible. Sin esto, el primer
 * síntoma era un 500 al subir el logo o el icono, o adjuntos entrantes "no
 * disponibles" (se reintentan al abrirlos, pero solo mientras Meta los
 * conserve), con el EACCES enterrado en el log de un request. Se prueba
 * escribiendo de verdad (lo mismo que hará saveMediaFile) y nunca tumba el
 * arranque: el resto del CRM funciona sin adjuntos.
 */
export async function checkMediaDir(): Promise<void> {
  let dir: string;
  try {
    dir = path.resolve(getEnv().MEDIA_DIR);
  } catch {
    return; // entorno inválido: lo reporta, con detalle, el primer getEnv() de la app
  }
  const probe = path.join(dir, `.prueba-escritura-${process.pid}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, "");
    await rm(probe, { force: true }).catch(() => {});
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code ?? String(err);
    log.error(
      `MEDIA_DIR=${dir} no es escribible (${code}): los adjuntos entrantes, el logo y el icono NO se van a poder guardar. ` +
        "En Docker: monta un volumen persistente en /data (la imagen ya usa /data/media) y arranca el contenedor como root —el default—, " +
        "que el entrypoint le da el volumen al usuario de la app. Fuera de Docker: apunta MEDIA_DIR a un directorio escribible."
    );
  }
}

/**
 * Aviso al arranque si falta META_APP_SECRET. Solo avisa, NUNCA tumba el
 * arranque: el resto del CRM sigue funcionando. Desde H7 el webhook de
 * WhatsApp rechaza (401) los eventos sin secreto, salvo en desarrollo con
 * los mocks (`isMockEnabled()`).
 */
export function warnIfWebhookUnsigned(): void {
  let secret: string | undefined;
  try {
    secret = getEnv().META_APP_SECRET;
  } catch {
    return; // entorno inválido: lo reporta, con detalle, el primer getEnv() de la app
  }
  const warning = unsignedWebhookWarning(secret, isMockEnabled());
  if (warning) log.warn(warning);
}

/**
 * Limpieza al arranque (FR-034): corridas del Laboratorio que quedaron
 * "running" tras un reinicio → fallidas. Solo corre en el runtime Node.
 */
export async function cleanupOrphanRuns(): Promise<void> {
  try {
    // Arranque, sobre todas las organizaciones: pool de sistema.
    const db = getSystemDb();
    const updated = await db
      .update(schema.agentTestRun)
      .set({
        status: "failed",
        error: "Interrumpida por un reinicio del servidor",
        finishedAt: new Date(),
      })
      .where(eq(schema.agentTestRun.status, "running"))
      .returning({ id: schema.agentTestRun.id });
    if (updated.length > 0) {
      log.info(`${updated.length} corrida(s) del Laboratorio huérfana(s) marcada(s) como fallida(s)`);
    }
  } catch (err) {
    // La BD puede no estar lista aún (migraciones corren antes del server).
    log.error("limpieza de corridas huérfanas falló", { err });
  }
}

/**
 * 021 / Campañas v2 (PR 2) — El programador de campañas: al arrancar y cada
 * 15 s retoma las que quedaron enviando (los reclamos abandonados se
 * recuperan sin reenviar), arranca las programadas y reanuda las pausas por
 * límite. Las de una organización con Campañas apagadas NO se tocan.
 */
export async function resumeSendingCampaigns(): Promise<void> {
  try {
    const { startCampaignScheduler } = await import("@/server/campaigns/dispatcher");
    startCampaignScheduler();
  } catch (err) {
    log.error("no se pudo arrancar el programador de campañas", { err });
  }
}
