/**
 * Migraciones al ARRANQUE del contenedor (no en pre-deploy: el pre-deploy de
 * plataformas como Coolify corre en el contenedor viejo). Se bundlea con
 * esbuild dentro de la imagen y corre antes de `node server.js`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] DATABASE_URL no está definida");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder =
  process.env.MIGRATIONS_DIR ?? path.join(here, "drizzle");

/**
 * Solo se reintenta lo que se arregla esperando: que la BD todavía no acepte
 * conexiones (el contenedor de Postgres arrancando). Un error de la migración
 * misma (p. ej. la 0024 que aborta porque encontró filas que cruzan
 * organizaciones) no se arregla esperando: se reporta de inmediato, con su
 * mensaje, en vez de 15 veces "BD no lista".
 */
const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "57P03", // cannot_connect_now: Postgres arrancando o en recuperación
]);
function isConnectionError(err) {
  const codes = [err?.code, err?.cause?.code, ...(err?.errors ?? []).map((e) => e?.code)];
  return codes.some((c) => CONNECTION_CODES.has(c));
}

const maxAttempts = 15;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  // TimeZone UTC: invariante de tiempo del proyecto (ver src/lib/db/index.ts).
  const sql = postgres(url, {
    max: 1,
    onnotice: () => {},
    connection: { TimeZone: "UTC" },
  });
  try {
    await migrate(drizzle(sql), { migrationsFolder });
    console.log("[migrate] migraciones aplicadas");
    await sql.end();
    process.exit(0);
  } catch (err) {
    await sql.end().catch((e) => console.error("[migrate] no se pudo cerrar la conexión:", e?.message ?? e));
    if (!isConnectionError(err)) {
      // El mensaje de Postgres primero: es lo que hay que leer en el log.
      console.error(`[migrate] la migración falló: ${err?.cause?.message ?? err?.message ?? err}`);
      console.error("[migrate] no se aplicó ninguna migración pendiente (todas van en una sola transacción).");
      process.exit(1);
    }
    if (attempt === maxAttempts) {
      console.error("[migrate] la BD no respondió tras varios intentos:", err?.message ?? err);
      process.exit(1);
    }
    console.log(
      `[migrate] BD no lista (intento ${attempt}/${maxAttempts}), reintento en 2s…`
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
}
