import { closeDbPools } from "@/lib/db";
import { logger } from "@/lib/log";

const log = logger("apagado");

/**
 * Operación 1 — APAGADO LIMPIO (spec 043, `apagado.md`).
 *
 * Un despliegue de Coolify detiene el contenedor viejo con SIGTERM y, si no
 * sale a tiempo («Stop grace period», 30 s por defecto), lo mata con SIGKILL.
 * Antes la señal se perdía (la shell era el PID 1) y, aunque llegara, Next se
 * quedaba esperando a que se cerraran las conexiones SSE, que nunca se
 * cierran solas. Ahora la imagen corre con `tini` y `NEXT_MANUAL_SIG_HANDLE`,
 * y este módulo se encarga de la señal:
 *
 * 1. Deja de aceptar trabajo nuevo: `isShuttingDown()` pasa a true (el
 *    programador de campañas se detiene, `/api/health` responde 503) y cada
 *    parte registrada con `onShutdown` recibe su `stop()`.
 * 2. Termina lo que está en curso, con tope (`SHUTDOWN_GRACE_MS`, 25 s):
 *    los despachadores de campañas (el envío que estaba a medias y sueltan su
 *    concesión), el procesamiento de webhooks ya acusados (`beginTask`) y los
 *    turnos del agente (los que esperaban su ventana se ADELANTAN). Además
 *    espera un mínimo para que terminen las peticiones HTTP en vuelo.
 * 3. Cierra los dos pools de la base y sale con código 0.
 *
 * Lo que no alcanzó a terminar lo recupera el contenedor nuevo como antes
 * (reclamos de campaña abandonados en `queue.ts`). Las conexiones SSE se
 * cortan al salir y el navegador se reconecta solo (catch-up con `since=`).
 *
 * Solo se instala con `NEXT_MANUAL_SIG_HANDLE=true` (la imagen la trae): sin
 * ella Next conserva su propio manejador y nada cambia (`next dev`, `next
 * start` a mano).
 */

/** Tope total del apagado. Debe caber en el «Stop grace period» de Coolify (30 s por defecto). */
export const DEFAULT_GRACE_MS = 25_000;
/** Mínimo de espera: lo que tarda en terminar una petición HTTP normal ya en vuelo. */
export const MIN_DRAIN_MS = 3_000;
/** Con menos de esto por delante, un webhook nuevo se rechaza con 503 (Meta lo reintenta). */
export const WEBHOOK_CUTOFF_MS = 10_000;
const POLL_MS = 100;

export type ShutdownPart = {
  /** Deja de aceptar trabajo nuevo (síncrono; no debe lanzar). */
  stop?: () => void;
  /** Se resuelve cuando lo que estaba en curso terminó. */
  drain?: () => Promise<unknown>;
};

type State = {
  draining: boolean;
  deadline: number;
  installed: boolean;
  seq: number;
  tasks: Map<number, string>;
  parts: Map<string, ShutdownPart>;
};

const globalForShutdown = globalThis as unknown as { __voceroShutdown?: State };

function state(): State {
  globalForShutdown.__voceroShutdown ??= {
    draining: false,
    deadline: Number.POSITIVE_INFINITY,
    installed: false,
    seq: 0,
    tasks: new Map(),
    parts: new Map(),
  };
  return globalForShutdown.__voceroShutdown;
}

export function graceMs(value = process.env.SHUTDOWN_GRACE_MS): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1_000 && n <= 600_000 ? n : DEFAULT_GRACE_MS;
}

/** ¿El proceso se está apagando? Quien arranca trabajo nuevo en segundo plano lo pregunta. */
export function isShuttingDown(): boolean {
  return state().draining;
}

/**
 * ¿Aceptar un webhook? Sí, salvo que ya no quede tiempo para procesarlo: en
 * ese caso la ruta responde 503 y Meta lo reintenta (le llegará al
 * contenedor nuevo). Nunca un 200 que luego no se procesa.
 */
export function acceptsWebhooks(now = Date.now()): boolean {
  const s = state();
  return !s.draining || s.deadline - now > WEBHOOK_CUTOFF_MS;
}

/**
 * Marca trabajo en segundo plano que el apagado debe esperar (p. ej. el
 * `after()` de un webhook ya acusado). Se abre ANTES de agendarlo y se cierra
 * en su `finally`.
 */
export function beginTask(name: string): { end: () => void } {
  const s = state();
  const id = ++s.seq;
  s.tasks.set(id, name);
  return { end: () => void s.tasks.delete(id) };
}

/** Registra una parte que sabe detenerse y esperar lo suyo. Mismo nombre = reemplaza. */
export function onShutdown(name: string, part: ShutdownPart): void {
  state().parts.set(name, part);
}

// --- Turnos del agente -------------------------------------------------------
// El mapa de «coalesce» vive en `src/server/ai/pipeline.ts` (en globalThis).
// Se LEE desde aquí sin importar ese archivo: una entrada con `timer` espera
// su ventana para juntar ráfagas; una con `running` está en curso; al
// terminar, el turno la borra del mapa.

type CoalesceEntry = { timer: ReturnType<typeof setTimeout> | null; running: boolean; pending: boolean };
type NodeTimer = { _onTimeout?: ((this: unknown) => void) | null };

function agentTurns(): Map<string, CoalesceEntry> | undefined {
  return (globalThis as unknown as { __agentCoalesce?: Map<string, CoalesceEntry> }).__agentCoalesce;
}

/**
 * Adelanta los turnos que esperaban su ventana: corre YA el mismo callback
 * que iba a correr el temporizador. Si el temporizador no lo expone (otra
 * versión de Node), se deja que venza solo (como mucho AGENT_COALESCE_MS).
 * Devuelve cuántos adelantó.
 */
export function advancePendingAgentTurns(map = agentTurns()): number {
  if (!map) return 0;
  let n = 0;
  for (const entry of map.values()) {
    const timer = entry.timer;
    if (!timer || entry.running) continue;
    const callback = (timer as unknown as NodeTimer)._onTimeout;
    if (typeof callback !== "function") continue;
    // clearTimeout borra `_onTimeout`: se toma antes.
    clearTimeout(timer);
    try {
      callback.call(timer);
      n++;
    } catch (err) {
      log.error("no se pudo adelantar un turno del agente", { err });
    }
  }
  return n;
}

function agentTurnsIdle(map = agentTurns()): boolean {
  return !map || map.size === 0;
}

// --- El apagado --------------------------------------------------------------

export type ShutdownDeps = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  closePools: () => Promise<void>;
  exit: (code: number) => void;
  graceMs: number;
  minDrainMs: number;
};

const defaultDeps = (): ShutdownDeps => ({
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  closePools: () => closeDbPools(3),
  exit: (code) => process.exit(code),
  graceMs: graceMs(),
  minDrainMs: MIN_DRAIN_MS,
});

export type ShutdownReport = { ms: number; timedOut: boolean; pending: string[] };

/** Lo que falta por terminar, en palabras (para el log). */
function pendingWork(s: State, drains: { name: string; done: boolean }[]): string[] {
  const out = drains.filter((d) => !d.done).map((d) => d.name);
  if (s.tasks.size > 0) out.push(`${s.tasks.size} tarea(s): ${[...new Set(s.tasks.values())].join(", ")}`);
  const turns = agentTurns();
  if (turns && turns.size > 0) out.push(`${turns.size} turno(s) del agente`);
  return out;
}

/** Corre el apagado completo. Una segunda llamada (otra señal) no hace nada. */
export async function shutdown(signal: string, overrides: Partial<ShutdownDeps> = {}): Promise<ShutdownReport | null> {
  const s = state();
  if (s.draining) {
    log.warn("señal repetida durante el apagado: se ignora", { senal: signal });
    return null;
  }
  const deps = { ...defaultDeps(), ...overrides };
  const start = deps.now();
  s.draining = true;
  s.deadline = start + deps.graceMs;
  log.info("apagado limpio: no se acepta trabajo nuevo; terminando lo que está en curso", {
    senal: signal,
    tope_ms: deps.graceMs,
  });

  for (const [name, part] of s.parts) {
    try {
      part.stop?.();
    } catch (err) {
      log.error("una parte falló al detenerse", { parte: name, err });
    }
  }
  const drains = [...s.parts].map(([name, part]) => {
    const d = { name, done: !part.drain };
    if (part.drain) {
      void part.drain().then(
        () => (d.done = true),
        (err: unknown) => {
          d.done = true;
          log.error("una parte falló al terminar", { parte: name, err });
        }
      );
    }
    return d;
  });

  let timedOut = false;
  for (;;) {
    advancePendingAgentTurns();
    const elapsed = deps.now() - start;
    const done = drains.every((d) => d.done) && s.tasks.size === 0 && agentTurnsIdle();
    if (done && elapsed >= deps.minDrainMs) break;
    if (deps.now() >= s.deadline) {
      timedOut = true;
      break;
    }
    await deps.sleep(POLL_MS);
  }

  const pending = timedOut ? pendingWork(s, drains) : [];
  if (timedOut) {
    log.warn("apagado: se acabó el tiempo; lo pendiente lo retoma el contenedor nuevo", { pendiente: pending.join("; ") });
  }
  try {
    await deps.closePools();
  } catch (err) {
    log.error("no se pudieron cerrar los pools de la base", { err });
  }
  const ms = deps.now() - start;
  log.info("apagado limpio terminado", { ms, a_tiempo: !timedOut });
  deps.exit(0);
  return { ms, timedOut, pending };
}

/**
 * Instala el manejador de SIGTERM/SIGINT. Solo con
 * `NEXT_MANUAL_SIG_HANDLE=true`: así Next no instala el suyo (que espera a
 * cerrar TODAS las conexiones, SSE incluidas) y no compiten dos.
 */
export function installShutdownHandler(): boolean {
  const s = state();
  if (s.installed) return true;
  if (process.env.NEXT_MANUAL_SIG_HANDLE !== "true") return false;
  s.installed = true;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => void shutdown(signal));
  }
  log.info("apagado limpio activo", { tope_ms: graceMs() });
  return true;
}

/** Solo para pruebas: vuelve al estado inicial. */
export function resetShutdownForTests(): void {
  globalForShutdown.__voceroShutdown = undefined;
}
