/**
 * Corre en el navegador antes de hidratar (Next 15.3+).
 *
 * zod 4 compila sus validaciones con `new Function` para ir más rápido. La
 * CSP de la app (S-09) prohíbe `eval`: zod lo detecta y sigue sin compilar,
 * pero el intento queda reportado como bloqueo en cada página. Con
 * `jitless` ni siquiera lo intenta (mismo resultado, sin ruido).
 *
 * Es lo mismo que `z.config({ jitless: true })`, pero sin importar zod aquí:
 * así esta pieza, que va en TODAS las páginas, no carga la librería entera.
 * zod guarda su configuración en `globalThis.__zod_globalConfig`
 * (zod/v4/core/core.js). Si una versión futura cambia ese nombre, el job e2e
 * lo detecta: la CSP volvería a reportar `eval`. En el servidor no hay CSP y
 * zod sigue compilando.
 */
const g = globalThis as { __zod_globalConfig?: { jitless?: boolean } };
// Se modifica el objeto (no se reemplaza): si zod ya lo creó, ve el cambio.
(g.__zod_globalConfig ??= {}).jitless = true;

export {};
