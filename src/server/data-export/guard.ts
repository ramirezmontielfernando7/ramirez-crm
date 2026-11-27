/**
 * 049 — Candado en memoria: una exportación de datos a la vez por organización
 * (es pesada). Vence solo a los 15 minutos por si un flujo se cae sin avisar.
 */
const running = new Map<string, number>();
const STALE_MS = 15 * 60_000;

export const exportLock = {
  /** Devuelve la función que libera el candado, o null si ya hay una en curso. */
  acquire(organizationId: string, now = Date.now()): (() => void) | null {
    const since = running.get(organizationId);
    if (since !== undefined && now - since < STALE_MS) return null;
    running.set(organizationId, now);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (running.get(organizationId) === now) running.delete(organizationId);
    };
  },
};
