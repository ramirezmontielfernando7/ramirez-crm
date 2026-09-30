import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Fase 1 multitenant (H27) — contexto de la request en curso: por ahora, la
 * organización. Lo abre `withAuth` (y la ingesta del webhook en cuanto sabe
 * de qué organización es el evento) para que cada línea de log diga a qué
 * negocio pertenece sin pasarlo a mano por 200 funciones. En el PR 3 de la
 * fase aquí mismo vivirá la transacción de `withTenant`.
 *
 * En globalThis: los módulos pueden evaluarse más de una vez (una por ruta en
 * dev) y todas las copias deben ver el mismo contexto.
 */
type RequestContext = { organizationId: string };

const globalForCtx = globalThis as unknown as {
  __voceroRequestContext?: AsyncLocalStorage<RequestContext>;
};

function storage(): AsyncLocalStorage<RequestContext> {
  return (globalForCtx.__voceroRequestContext ??= new AsyncLocalStorage<RequestContext>());
}

export function runWithOrganization<T>(organizationId: string, fn: () => T): T {
  return storage().run({ organizationId }, fn);
}

/** La organización de la request/trabajo en curso, o `null` fuera de uno. */
export function currentOrganizationId(): string | null {
  return storage().getStore()?.organizationId ?? null;
}
