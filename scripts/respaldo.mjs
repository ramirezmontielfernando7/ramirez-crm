/**
 * Operación 1 — Respaldo A MANO de la base (y de los archivos de /data/media).
 * Herramienta del OPERADOR; no tiene botón en la interfaz a propósito. Los
 * respaldos PROGRAMADOS los hace Coolify (guía: docs/respaldos.md); este
 * guion sirve antes de un cambio delicado, para llevarse una copia a mano, o
 * si los de Coolify fallan.
 *
 *   node scripts/respaldo.mjs                    (base + archivos, guarda los 7 más nuevos)
 *   node scripts/respaldo.mjs --sin-media        (solo la base)
 *   node scripts/respaldo.mjs --solo-media       (solo los archivos: la tarea programada de Coolify)
 *   node scripts/respaldo.mjs --guardar 14       (cuántos respaldos conservar en la carpeta)
 *   node scripts/respaldo.mjs --dir /otra/ruta   (carpeta de salida; por defecto /data/backups)
 *
 * En la imagen de Docker viaja como `/app/ops/respaldo.mjs`:
 *   docker exec <contenedor de la app> node ops/respaldo.mjs
 *
 * Qué deja en la carpeta (permisos 600: solo el dueño los lee):
 * - `dashfort-<base>-<AAAAMMDD-HHMMSS>.dump` — `pg_dump` en formato propio
 *   (comprimido; se restaura con `pg_restore`), con su `.sha256`.
 * - `dashfort-<base>-<…>-media.tar.gz` — los archivos de MEDIA_DIR (adjuntos,
 *   logo, ícono, documentos), con su `.sha256`.
 *
 * Reglas:
 * - Conecta con DATABASE_URL_MIGRATE (el dueño `postgres`); sin ella, con
 *   DATABASE_URL. Con un rol sujeto a RLS pg_dump FALLA en vez de sacar un
 *   respaldo vacío (pg_dump apaga `row_security`): nunca un respaldo a medias
 *   que parezca bueno.
 * - pg_dump debe ser de la misma versión que el servidor o más nueva; si no,
 *   se niega antes de empezar.
 * - Escribe primero `*.partial` y solo renombra cuando `pg_restore --list` lo
 *   pudo leer: un archivo `.dump` siempre está completo.
 * - Solo borra respaldos VIEJOS hechos por este guion (`dashfort-…`), nunca
 *   otros archivos de la carpeta. Los de base y los de solo archivos se
 *   cuentan por separado: una tarea diaria de archivos no borra la copia de
 *   la base que sacaste a mano.
 * - NO incluye la ENCRYPTION_KEY (vive en las variables de Coolify): sin ella
 *   los tokens de la copia no se pueden leer. Guárdala aparte.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import {
  aBorrar,
  libpqEnv,
  mayorDelServidor,
  nombreRespaldo,
  problemaDeVersion,
  tamano,
  versionMayor,
} from "./lib/respaldos-core.mjs";

const args = { dir: "/data/backups", guardar: 7, base: true, media: true };
const rest = process.argv.slice(2);
for (let i = 0; i < rest.length; i++) {
  const k = rest[i]?.replace(/^--/, "");
  if (k === "sin-media") args.media = false;
  else if (k === "solo-media") args.base = false;
  else if (k === "dir") args.dir = rest[++i];
  else if (k === "guardar") args.guardar = Number(rest[++i]);
  else uso(`opción desconocida: ${rest[i]}`);
}

function uso(msg) {
  if (msg) console.error(`Error: ${msg}`);
  console.error("Uso: respaldo.mjs [--sin-media | --solo-media] [--guardar N] [--dir carpeta]");
  process.exit(2);
}

if (!args.base && !args.media) uso("--sin-media y --solo-media juntos no respaldan nada");
if (!args.dir || !path.isAbsolute(args.dir)) uso("--dir debe ser una ruta absoluta");
if (!Number.isInteger(args.guardar) || args.guardar < 1 || args.guardar > 365) uso("--guardar debe ser un número de 1 a 365");
const url = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!url && args.base) uso("falta DATABASE_URL_MIGRATE (o DATABASE_URL)");

/** Carpeta de los binarios de Postgres: en la imagen, PG_BIN=/usr/libexec/postgresql18 (Dockerfile); si no, el PATH. */
const bin = (nombre) => (process.env.PG_BIN ? path.join(process.env.PG_BIN, nombre) : nombre);

/** Corre un programa; resuelve con su salida o rechaza con su error (sin la contraseña, que va por entorno). */
function correr(cmd, argv, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) =>
      reject(e.code === "ENOENT" ? new Error(`no se encontró «${cmd}» en esta imagen (¿falta postgresql18-client?)`) : e)
    );
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${path.basename(cmd)} terminó con código ${code}: ${err.trim().slice(0, 600)}`))
    );
  });
}

async function sha256(archivo) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(archivo)) h.update(chunk);
  return h.digest("hex");
}

async function conSuma(archivo) {
  const suma = await sha256(archivo);
  await writeFile(`${archivo}.sha256`, `${suma}  ${path.basename(archivo)}\n`, { mode: 0o600 });
  return suma;
}

async function main() {
  await mkdir(args.dir, { recursive: true, mode: 0o700 });
  const base = nombreRespaldo(url ? libpqEnv(url).PGDATABASE : "media");
  if (args.base) await respaldarBase(base);
  if (args.media) {
    try {
      await respaldarArchivos(base);
    } catch (err) {
      throw new Error(args.base ? `la base SÍ quedó respaldada, pero los archivos no: ${err.message}` : err.message);
    }
  }

  const viejos = aBorrar(await readdir(args.dir), args.guardar);
  for (const v of viejos) await rm(path.join(args.dir, v), { force: true });
  if (viejos.length > 0) console.log(`· Limpieza: se borraron ${viejos.length} archivo(s) de respaldos viejos (se guardan los ${args.guardar} más nuevos de cada tipo).`);

  console.log("");
  console.log("Recuerda:");
  console.log("  - Este respaldo vive en el MISMO servidor. Bájalo a tu computadora (docs/respaldos.md, paso «Bajar una copia»).");
  console.log("  - NO incluye la ENCRYPTION_KEY. Sin ella, los tokens de esta copia no se pueden leer: guárdala aparte.");
}

async function respaldarBase(base) {
  const pgEnv = libpqEnv(url);
  const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });
  let servidor;
  let pesoBase;
  try {
    const [v] = await sql`select current_setting('server_version_num') as num, pg_database_size(current_database())::bigint as bytes`;
    servidor = mayorDelServidor(v?.num);
    pesoBase = Number(v?.bytes ?? 0);
  } finally {
    await sql.end();
  }

  const cliente = versionMayor(await correr(bin("pg_dump"), ["--version"]));
  const problema = problemaDeVersion(cliente, servidor);
  if (problema) throw new Error(problema);
  console.log(`Base «${pgEnv.PGDATABASE}» en ${pgEnv.PGHOST}: PostgreSQL ${servidor}, ${tamano(pesoBase)} en disco. pg_dump ${cliente}.`);

  const libre = await statfs(args.dir).then((s) => s.bavail * s.bsize);
  // El respaldo comprimido suele pesar mucho menos que la base; pedir al
  // menos su tamaño es un margen holgado y evita llenar el volumen.
  if (libre < pesoBase) {
    throw new Error(
      `poco espacio en ${args.dir}: quedan ${tamano(libre)} y la base pesa ${tamano(pesoBase)}. ` +
        `Borra respaldos viejos (o baja --guardar) y repite.`
    );
  }

  const dump = path.join(args.dir, `${base}.dump`);
  const parcial = `${dump}.partial`;
  const inicio = Date.now();
  try {
    await correr(bin("pg_dump"), ["--format=custom", "--compress=6", "--file", parcial], pgEnv);
    await chmod(parcial, 0o600);
    // ¿Se puede leer? pg_restore --list recorre el índice completo del archivo.
    const lista = await correr(bin("pg_restore"), ["--list", parcial]);
    const tablas = lista.split("\n").filter((l) => / TABLE DATA /.test(l)).length;
    if (tablas === 0) throw new Error("el respaldo no trae datos de ninguna tabla");
    await rename(parcial, dump);
    const suma = await conSuma(dump);
    const { size } = await stat(dump);
    console.log(`✔ Base respaldada: ${dump}`);
    console.log(`  ${tamano(size)} · ${tablas} tablas con datos · ${Math.round((Date.now() - inicio) / 1000)} s · sha256 ${suma.slice(0, 16)}…`);
  } catch (err) {
    await rm(parcial, { force: true });
    throw err;
  }
}

async function respaldarArchivos(base) {
  const mediaDir = path.resolve(process.env.MEDIA_DIR || "/data/media");
  const hay = await stat(mediaDir).then((s) => s.isDirectory(), () => false);
  if (!hay) {
    console.log(`· Archivos: ${mediaDir} no existe; no hay nada que respaldar.`);
    return;
  }
  const tar = path.join(args.dir, `${base}-media.tar.gz`);
  const parcialTar = `${tar}.partial`;
  try {
    await correr("tar", ["-czf", parcialTar, "-C", path.dirname(mediaDir), path.basename(mediaDir)]);
    await chmod(parcialTar, 0o600);
    await rename(parcialTar, tar);
    await conSuma(tar);
    const { size } = await stat(tar);
    console.log(`✔ Archivos respaldados: ${tar} (${tamano(size)})`);
  } catch (err) {
    await rm(parcialTar, { force: true });
    throw err;
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exitCode = 1;
});
