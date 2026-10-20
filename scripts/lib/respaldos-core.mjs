/**
 * Operación 1 — Reglas PURAS de los respaldos (sin red, sin disco, sin
 * procesos). Las usan `scripts/respaldo.mjs` y
 * `scripts/probar-restauracion.mjs`; las prueba
 * `tests/unit/respaldos-core.test.ts`.
 */

/** Prefijo de los archivos que sacan nuestros guiones (lo único que la limpieza borra). */
export const PREFIJO_ARCHIVO = "dashfort-";
/** Prefijo de la base temporal de la prueba de restauración. Nunca otro nombre. */
export const PREFIJO_PRUEBA = "vocero_prueba_restauracion_";

/**
 * La URL de conexión → variables de entorno de libpq (PGHOST, PGPASSWORD…).
 * Así la contraseña no aparece en la lista de procesos (`ps`), como pasaría
 * pasando la URL como argumento de pg_dump.
 */
export function libpqEnv(url) {
  const u = new URL(url);
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("la URL de la base no es postgres://");
  const env = {
    PGHOST: decodeURIComponent(u.hostname),
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  const ssl = u.searchParams.get("sslmode");
  if (ssl) env.PGSSLMODE = ssl;
  if (!env.PGDATABASE) throw new Error("la URL de la base no dice el nombre de la base");
  return env;
}

/** «pg_dump (PostgreSQL) 18.6» → 18. null si no se entiende. */
export function versionMayor(texto) {
  const m = /\b(\d{2,})(?:\.\d+)?/.exec(String(texto));
  return m ? Number(m[1]) : null;
}

/** `server_version_num` (180006) → 18. */
export function mayorDelServidor(versionNum) {
  const n = Number(versionNum);
  return Number.isFinite(n) && n > 0 ? Math.floor(n / 10000) : null;
}

/**
 * pg_dump solo respalda servidores de su versión o MENORES. Devuelve el
 * motivo para no seguir, o null si se puede.
 */
export function problemaDeVersion(mayorCliente, mayorServidor) {
  if (mayorCliente === null) return "no se pudo leer la versión de pg_dump";
  if (mayorServidor === null) return "no se pudo leer la versión del servidor";
  if (mayorCliente < mayorServidor) {
    return (
      `pg_dump es versión ${mayorCliente} y el servidor es ${mayorServidor}: ` +
      `un pg_dump más viejo que el servidor no puede respaldarlo. ` +
      `Usa una imagen con postgresql${mayorServidor}-client, o saca el respaldo dentro del contenedor de Postgres (docs/respaldos.md).`
    );
  }
  return null;
}

/** Fecha en UTC para nombres de archivo: 2026-10-20T03-00-00Z → «20261020-030000». */
export function sello(fecha = new Date()) {
  return fecha.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

/** Nombre base de un respaldo (sin extensión). Solo letras, números, guion y guion bajo. */
export function nombreRespaldo(baseDeDatos, fecha = new Date()) {
  const limpia = String(baseDeDatos).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "base";
  return `${PREFIJO_ARCHIVO}${limpia}-${sello(fecha)}`;
}

/** Nombre de la base temporal. Solo minúsculas, números y guion bajo. */
export function nombreBasePrueba(fecha = new Date()) {
  return `${PREFIJO_PRUEBA}${sello(fecha).replace("-", "_")}`;
}

/**
 * El candado de la prueba de restauración: solo se crea, restaura y borra una
 * base que (1) tiene nuestro prefijo, (2) es un identificador simple y (3) NO
 * es la base de producción. Lanza si algo no cuadra.
 */
export function assertBaseDePrueba(nombre, baseDeProduccion) {
  if (typeof nombre !== "string" || !nombre.startsWith(PREFIJO_PRUEBA)) {
    throw new Error(`«${nombre}» no es una base de prueba (debe empezar con ${PREFIJO_PRUEBA})`);
  }
  if (!/^[a-z0-9_]{1,63}$/.test(nombre)) throw new Error(`«${nombre}» no es un nombre de base válido`);
  if (nombre === baseDeProduccion) throw new Error("la base de prueba no puede ser la de producción");
  return nombre;
}

/**
 * Qué respaldos borrar para quedarse con los `guardar` más nuevos DE CADA
 * TIPO: los que traen la base (`.dump`) y los de solo archivos
 * (`-media.tar.gz` sin `.dump`). Solo cuenta archivos nuestros
 * (`dashfort-…`); agrupa cada respaldo con su `.sha256` por el nombre base.
 */
export function aBorrar(archivos, guardar) {
  if (!Number.isInteger(guardar) || guardar < 1) throw new Error("--guardar debe ser un entero mayor que 0");
  const re = new RegExp(`^(${PREFIJO_ARCHIVO}[A-Za-z0-9_-]+-\\d{8}-\\d{6})(\\.dump|\\.dump\\.sha256|-media\\.tar\\.gz|-media\\.tar\\.gz\\.sha256)$`);
  const grupos = new Map();
  for (const a of archivos) {
    const m = re.exec(a);
    if (!m) continue;
    const base = m[1];
    if (!grupos.has(base)) grupos.set(base, []);
    grupos.get(base).push(a);
  }
  // Más nuevo primero: el sello de fecha va al final del nombre base.
  const masNuevo = (x, y) => y.slice(-15).localeCompare(x.slice(-15)) || y.localeCompare(x);
  const conBase = [...grupos.keys()].filter((b) => grupos.get(b).includes(`${b}.dump`)).sort(masNuevo);
  const soloArchivos = [...grupos.keys()].filter((b) => !grupos.get(b).includes(`${b}.dump`)).sort(masNuevo);
  return [...conBase.slice(guardar), ...soloArchivos.slice(guardar)].flatMap((b) => grupos.get(b).sort()).sort();
}

/** 1536 → «1.5 KB». */
export function tamano(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "?";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(1)} ${u[i]}`;
}

/** ¿El archivo es un respaldo en formato propio de pg_dump («PGDMP» al inicio)? */
export function esFormatoPropio(primerosBytes) {
  return Buffer.from(primerosBytes).subarray(0, 5).toString("latin1") === "PGDMP";
}

/** ¿Es un .gz (1f 8b)? */
export function esGzip(primerosBytes) {
  const b = Buffer.from(primerosBytes);
  return b[0] === 0x1f && b[1] === 0x8b;
}

/**
 * Las columnas cifradas de una tabla: de `[…, "token_cipher", "token_iv",
 * "token_tag", "key_version"]` saca `[{ cipher, iv, tag }]` (solo los tríos
 * completos). Sin `key_version`, nada.
 */
export function triosCifrados(columnas) {
  const set = new Set(columnas);
  if (!set.has("key_version")) return [];
  return columnas
    .filter((c) => c.endsWith("_cipher"))
    .map((c) => {
      const base = c.slice(0, -"_cipher".length);
      return { cipher: c, iv: `${base}_iv`, tag: `${base}_tag` };
    })
    .filter((t) => set.has(t.iv) && set.has(t.tag));
}
