/**
 * Migraciones al ARRANQUE del contenedor (no en pre-deploy: el pre-deploy de
 * plataformas como Coolify corre en el contenedor viejo). Se bundlea con
 * esbuild dentro de la imagen y corre antes de `node server.js`.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PR 3 multitenant: las migraciones corren con el DUEÑO del esquema
 * (DATABASE_URL_MIGRATE). La app, en cuanto el operador cambia DATABASE_URL,
 * corre como `vocero_app`, que no puede hacer DDL. Sin DATABASE_URL_MIGRATE
 * se usa DATABASE_URL: una instalación que todavía no separó los roles sigue
 * migrando igual que antes.
 */
const url = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] ni DATABASE_URL_MIGRATE ni DATABASE_URL están definidas");
  process.exit(1);
}

/** Roles de la 0026 y la variable que trae la contraseña de cada uno. */
const ROLES = [
  { role: "vocero_app", env: "VOCERO_APP_DB_PASSWORD" },
  { role: "vocero_system", env: "VOCERO_SYSTEM_DB_PASSWORD" },
];

/**
 * El verificador SCRAM-SHA-256 que Postgres guarda (RFC 5802/7677), calculado
 * AQUÍ: al servidor solo viaja el hash, así que la contraseña en claro no
 * aparece en su log aunque tenga `log_statement = 'all'`.
 */
function scramVerifier(password, salt = randomBytes(16), iterations = 4096) {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/**
 * Tras migrar: (1) repite los GRANT de la 0026 —cubre tablas creadas por otro
 * dueño—, (2) si el operador definió la contraseña de un rol, le da LOGIN con
 * ella. Sin la variable el rol queda como esté (NOLOGIN al nacer): nada se
 * activa por sorpresa.
 */
async function setupRoles(sql) {
  const existentes = new Set(
    (await sql`select rolname from pg_roles where rolname in ('vocero_app', 'vocero_system')`).map(
      (r) => r.rolname
    )
  );
  const grantees = ROLES.map((r) => r.role).filter((r) => existentes.has(r));
  if (grantees.length > 0) {
    const lista = grantees.join(", ");
    await sql.unsafe(`grant usage on schema public to ${lista}`);
    await sql.unsafe(`grant select, insert, update, delete on all tables in schema public to ${lista}`);
    await sql.unsafe(`grant usage, select on all sequences in schema public to ${lista}`);
  }
  for (const { role, env } of ROLES) {
    const password = process.env[env];
    if (!password) continue;
    if (!existentes.has(role)) {
      throw new Error(`${env} está definida pero el rol ${role} no existe`);
    }
    // ASCII imprimible: sin SASLprep, el hash coincide con el de Postgres.
    if (password.length < 16 || !/^[\x21-\x7e]+$/.test(password)) {
      throw new Error(`${env} debe tener al menos 16 caracteres ASCII visibles, sin espacios (p. ej. openssl rand -hex 24)`);
    }
    const verifier = scramVerifier(password);
    await sql.unsafe(`alter role ${role} login password '${verifier}'`);
    console.log(`[migrate] ${role}: LOGIN con la contraseña de ${env}`);
  }
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
    try {
      await setupRoles(sql);
    } catch (err) {
      await sql.end();
      console.error(`[migrate] migraciones aplicadas, pero los roles de BD fallaron: ${err?.message ?? err}`);
      process.exit(1);
    }
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
