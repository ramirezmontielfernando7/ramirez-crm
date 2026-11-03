import { sql } from "drizzle-orm";
import { getSystemDb } from "@/lib/db";
import { logger } from "@/lib/log";
import { UNCONFIRMED_SEND_TEXT } from "@/server/inbox/send";

/**
 * Auditoría DF-13 — Envíos por Meta que quedaron a medias.
 *
 * Desde DF-13 el saliente se registra ANTES de llamar a Meta. Si el proceso
 * muere justo entonces (o la base no pudo guardar el ID que devolvió Meta),
 * la fila queda `pending` sin `wa_message_id` para siempre, con el reloj
 * puesto. Aquí, al arrancar y cada 10 minutos, lo que lleva más de 10
 * minutos así pasa a «fallido» con el motivo «no se sabe si llegó»: nunca se
 * reenvía solo (podría duplicarse) y quien atiende decide.
 *
 * No toca: la conexión directa (tiene su propia fila y recuperación), las
 * reservas de campañas (las recupera `recoverAbandoned`) ni el Laboratorio
 * (no tiene reservas).
 */

export const INTERRUPTED_AFTER_MS = 10 * 60 * 1000;

const log = logger("send");

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

export async function recoverInterruptedSends(now = new Date()): Promise<number> {
  const limite = new Date(now.getTime() - INTERRUPTED_AFTER_MS).toISOString();
  const rows = (await sys().execute(sql`
    update message m
       set status = 'failed', error = ${UNCONFIRMED_SEND_TEXT}, failed_at = ${now.toISOString()}::timestamp
     where m.direction = 'out'
       and m.status = 'pending'
       and m.wa_message_id is null
       and m.transport is distinct from 'directa'
       and m.created_at < ${limite}::timestamp
       and not exists (
         select 1 from campaign_recipient r
          where r.organization_id = m.organization_id and r.message_id = m.id
       )
    returning m.id
  `)) as unknown as { id: string }[];
  return rows.length;
}

const globalForRecovery = globalThis as unknown as { __voceroInterruptedSends?: NodeJS.Timeout };

/** Al arrancar y cada 10 minutos (en proceso, como el resto del trabajo de fondo). */
export function startInterruptedSendsRecovery(): void {
  if (globalForRecovery.__voceroInterruptedSends) return;
  const run = async () => {
    try {
      const n = await recoverInterruptedSends();
      if (n > 0) log.warn(`${n} envío(s) por Meta interrumpido(s): quedan como fallidos «no se sabe si llegó»`);
    } catch (err) {
      log.error("no se pudieron revisar los envíos interrumpidos", { err });
    }
  };
  void run();
  globalForRecovery.__voceroInterruptedSends = setInterval(() => void run(), INTERRUPTED_AFTER_MS);
  globalForRecovery.__voceroInterruptedSends.unref();
}
