import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { logger } from "@/lib/log";
import {
  activeBroadcastOf,
  KILL_SWITCH_KEYS,
  type BroadcastDto,
  type BroadcastLevel,
  type KillSwitchKey,
  type KillSwitchState,
} from "@/lib/platform-controls";
import { recordPlatformAudit, type AuditActor } from "@/server/platform-admin/audit";

const log = logger("platform-controls");

/**
 * 048 — Controles de TODA la plataforma: interruptores de emergencia
 * (`platform_kill_switch`) y el aviso a todos los clientes
 * (`platform_broadcast`). Tablas de PLATAFORMA (sin organización): solo el
 * pool de sistema. ÚNICA puerta. Lo leen caminos calientes (cada llamada a
 * la IA, cada vuelta del despachador de campañas), así que se recuerda unos
 * segundos por proceso; quien lo cambia en este proceso lo olvida al
 * instante. Si la lectura falla, NO se frena nada (un hipo de la BD no apaga
 * la IA de todos) y queda en el log.
 */

const TTL_MS = 10_000;
type Cache = { at: number; switches: Record<KillSwitchKey, KillSwitchState>; broadcast: BroadcastDto | null };
const g = globalThis as unknown as { __voceroPlatformControls?: Cache | null };

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

export function forgetPlatformControls(): void {
  g.__voceroPlatformControls = null;
}

const off = (): Record<KillSwitchKey, KillSwitchState> =>
  Object.fromEntries(KILL_SWITCH_KEYS.map((k) => [k, { key: k, active: false, reason: null, updatedAt: null }])) as Record<
    KillSwitchKey,
    KillSwitchState
  >;

async function load(): Promise<Cache> {
  const hit = g.__voceroPlatformControls;
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const now = new Date();
  const [rows, bc] = await Promise.all([
    sys().select().from(schema.platformKillSwitch),
    sys()
      .select()
      .from(schema.platformBroadcast)
      .where(
        and(
          isNull(schema.platformBroadcast.endedAt),
          lte(schema.platformBroadcast.startsAt, now),
          or(isNull(schema.platformBroadcast.endsAt), gt(schema.platformBroadcast.endsAt, now))
        )
      )
      .orderBy(desc(schema.platformBroadcast.createdAt))
      .limit(5),
  ]);
  const switches = off();
  for (const r of rows) {
    if ((KILL_SWITCH_KEYS as readonly string[]).includes(r.key)) {
      switches[r.key] = { key: r.key, active: r.active, reason: r.reason, updatedAt: r.updatedAt.toISOString() };
    }
  }
  const cache: Cache = { at: Date.now(), switches, broadcast: activeBroadcastOf(bc.map(toDto), now) };
  g.__voceroPlatformControls = cache;
  return cache;
}

function toDto(r: typeof schema.platformBroadcast.$inferSelect): BroadcastDto {
  return {
    id: r.id,
    message: r.message,
    level: r.level,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** ¿Está apagada esta función para TODAS las organizaciones? Ante un error, no. */
export async function isKilled(key: KillSwitchKey): Promise<boolean> {
  try {
    return (await load()).switches[key].active;
  } catch (err) {
    log.error("no se pudo leer el interruptor de emergencia; se deja pasar", { key, err });
    return false;
  }
}

export async function listKillSwitches(): Promise<KillSwitchState[]> {
  forgetPlatformControls();
  const { switches } = await load();
  return KILL_SWITCH_KEYS.map((k) => switches[k]);
}

export async function setKillSwitch(
  key: KillSwitchKey,
  active: boolean,
  reason: string | null,
  actor: AuditActor,
  ip: string | null
): Promise<KillSwitchState[]> {
  const set = { active, reason: reason?.trim() || null, updatedAt: new Date(), updatedBy: actor?.userId ?? null };
  await sys().insert(schema.platformKillSwitch).values({ key, ...set }).onConflictDoUpdate({ target: schema.platformKillSwitch.key, set });
  forgetPlatformControls();
  await recordPlatformAudit({ actor, action: "controls.kill_switch_changed", detail: { funcion: key, apagada: active, motivo: set.reason }, ip });
  log.warn("interruptor de emergencia", { key, active });
  return listKillSwitches();
}

/** El aviso vigente para todos (o `null`). Ante un error, ninguno. */
export async function getActiveBroadcast(): Promise<BroadcastDto | null> {
  try {
    return (await load()).broadcast;
  } catch (err) {
    log.error("no se pudo leer el aviso para todos", { err });
    return null;
  }
}

/** Los últimos avisos (vigentes o no), para la pantalla de Plataforma. */
export async function listBroadcasts(limit = 10): Promise<BroadcastDto[]> {
  const rows = await sys().select().from(schema.platformBroadcast).orderBy(desc(schema.platformBroadcast.createdAt)).limit(limit);
  return rows.map(toDto);
}

/**
 * Publica un aviso nuevo. Uno vigente a la vez: el anterior se cierra en la
 * misma operación. `endsAt` opcional (se quita solo).
 */
export async function startBroadcast(
  input: { message: string; level: BroadcastLevel; endsAt: Date | null },
  actor: AuditActor,
  ip: string | null
): Promise<BroadcastDto> {
  const now = new Date();
  const id = newId("broadcast");
  await sys().transaction(async (tx) => {
    await tx.update(schema.platformBroadcast).set({ endedAt: now }).where(isNull(schema.platformBroadcast.endedAt));
    await tx.insert(schema.platformBroadcast).values({
      id,
      message: input.message.trim(),
      level: input.level,
      startsAt: now,
      endsAt: input.endsAt,
      createdBy: actor?.userId ?? null,
    });
  });
  forgetPlatformControls();
  await recordPlatformAudit({ actor, action: "controls.broadcast_started", detail: { nivel: input.level, termina: input.endsAt?.toISOString() ?? null }, ip });
  const [row] = await sys().select().from(schema.platformBroadcast).where(eq(schema.platformBroadcast.id, id)).limit(1);
  return toDto(row!);
}

/** Quita el aviso vigente (si hay). */
export async function endBroadcast(actor: AuditActor, ip: string | null): Promise<void> {
  const ended = await sys()
    .update(schema.platformBroadcast)
    .set({ endedAt: new Date() })
    .where(isNull(schema.platformBroadcast.endedAt))
    .returning({ id: schema.platformBroadcast.id });
  forgetPlatformControls();
  if (ended.length > 0) await recordPlatformAudit({ actor, action: "controls.broadcast_ended", ip });
}
