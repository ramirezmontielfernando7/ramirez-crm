import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Fase 1 multitenant — contexto del trabajo en curso (una request, un turno
 * del agente, una corrida del Laboratorio…):
 *
 *   * `organizationId` (H27, PR 1): cada línea de log dice a qué negocio
 *     pertenece, y (PR 3) cada consulta del pool de la app fija
 *     `app.org_id` con ella (`src/lib/db/index.ts`).
 *   * `tx` (PR 3): la transacción abierta por `withTenant`; `getDb()` la
 *     devuelve para que todo lo que corra dentro vaya por ella.
 *   * `inTransaction` (PR 3): hay una transacción abierta (de `withTenant` o
 *     un `db.transaction()` explícito). Con ella abierta está prohibido
 *     llamar al LLM: la conexión quedaría tomada durante segundos.
 *
 * En globalThis: los módulos pueden evaluarse más de una vez (una por ruta en
 * dev) y todas las copias deben ver el mismo contexto.
 */
type RequestContext = {
  organizationId: string | null;
  tx?: unknown;
  inTransaction?: boolean;
};

const globalForCtx = globalThis as unknown as {
  __voceroRequestContext?: AsyncLocalStorage<RequestContext>;
};

function storage(): AsyncLocalStorage<RequestContext> {
  return (globalForCtx.__voceroRequestContext ??= new AsyncLocalStorage<RequestContext>());
}

/**
 * Corre `fn` a nombre de una organización: sus consultas al pool de la app
 * fijan `app.org_id` y sus logs llevan `org=`. No abre transacción: cada
 * consulta sigue confirmándose sola, igual que antes del PR 3.
 */
export function runWithOrganization<T>(
  organizationId: string,
  fn: () => T
): T extends PromiseLike<infer U> ? Promise<U> : T {
  return storage().run({ organizationId }, () => startInside(fn())) as never;
}

/**
 * Las consultas de drizzle son perezosas: `() => db.select()…` devuelve un
 * thenable que recién se ejecuta al hacerle `await`, que ocurriría FUERA del
 * contexto. Se le llama `then` aquí dentro para que arranque con él.
 */
function startInside<T>(value: T): T | Promise<unknown> {
  if (value !== null && typeof value === "object" && typeof (value as { then?: unknown }).then === "function") {
    return new Promise((resolve, reject) => (value as unknown as PromiseLike<unknown>).then(resolve, reject));
  }
  return value;
}

/** La organización de la request/trabajo en curso, o `null` fuera de uno. */
export function currentOrganizationId(): string | null {
  return storage().getStore()?.organizationId ?? null;
}

/** Uso interno de `src/lib/db`: marca `fn` como dentro de una transacción. */
export function runInTransaction<T>(
  organizationId: string | null,
  tx: unknown,
  fn: () => T
): T {
  return storage().run({ organizationId, tx, inTransaction: true }, fn);
}

/** La transacción de `withTenant` en curso, o `undefined`. */
export function currentTransaction(): unknown {
  return storage().getStore()?.tx;
}

/** true si el trabajo en curso tiene una transacción de BD abierta. */
export function hasOpenTransaction(): boolean {
  return storage().getStore()?.inTransaction === true;
}
