/**
 * Prueba de carga (2026-11): con ~36 mil chats por empresa, recontar la bandeja
 * cuesta ~1.7 s y la pide cada asesor tras cada aviso. Se comparte el resultado
 * unos segundos (y la misma consulta en curso) por llave; la llave SIEMPRE
 * empieza con la organización, así que nunca se cruzan negocios.
 * Cache por proceso: con una sola copia de la app basta.
 */
export const COUNTS_TTL_MS = 3_000;
export const SELECTORS_TTL_MS = 15_000;
/** Las etapas presentes casi no cambian y su consulta es la más cara de los selectores. */
export const STAGES_TTL_MS = 60_000;
/** Un resultado vencido solo se entrega mientras se recalcula si es así de reciente (× TTL). */
const STALE_FACTOR = 5;
const MEMO_MAX = 2_000;

type MemoEntry = { at: number; value?: Promise<unknown>; pending?: Promise<unknown> };
const memo = new Map<string, MemoEntry>();

/**
 * Como mucho UN cálculo en curso por llave. Mientras se recalcula, quien
 * pregunta recibe el último resultado si es reciente: bajo carga un conteo
 * puede tardar más que el TTL, y sin esto se encimaban cálculos iguales. Uno
 * viejo (p. ej. de hace una hora) no se entrega: se espera el nuevo.
 */
export function memoized<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  // Las pruebas cambian datos y vuelven a contar al instante: sin cache.
  if (process.env.VITEST) return load();
  const now = Date.now();
  const hit = memo.get(key);
  const age = hit?.value ? now - hit.at : Infinity;
  if (hit?.value && age < ttlMs) return hit.value as Promise<T>;
  const usable = age < ttlMs * STALE_FACTOR ? hit?.value : undefined;
  if (hit?.pending) return (usable ?? hit.pending) as Promise<T>;
  const entry: MemoEntry = hit ?? { at: 0 };
  const pending = load();
  entry.pending = pending;
  memo.set(key, entry);
  pending.then(
    () => {
      entry.value = pending;
      entry.at = Date.now();
      entry.pending = undefined;
    },
    () => {
      entry.pending = undefined;
      if (!entry.value) memo.delete(key);
    }
  );
  if (memo.size > MEMO_MAX) {
    for (const [k, v] of memo) if (!v.pending && now - v.at > STAGES_TTL_MS * STALE_FACTOR) memo.delete(k);
  }
  return (usable ?? pending) as Promise<T>;
}

/**
 * Cambió algo que muestran los selectores de la bandeja (etiquetas, quién
 * atiende, etapas): la próxima vez se recalcula todo lo de esa organización
 * (los contadores llevan dentro las listas de los selectores). Se llama
 * DESPUÉS de guardar, fuera de la transacción.
 */
export function forgetInboxCounts(organizationId: string): void {
  for (const prefix of ["counts", "selectors", "stages"]) {
    for (const k of memo.keys()) if (k.startsWith(`${prefix}|${organizationId}|`)) memo.delete(k);
  }
}
