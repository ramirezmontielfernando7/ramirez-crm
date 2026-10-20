/**
 * Operación 1 — PRUEBA de restauración: ¿este respaldo de verdad se puede
 * restaurar? Lo restaura en una base TEMPORAL, revisa lo que trae y la borra.
 * NUNCA toca la base de producción. Herramienta del OPERADOR (la prueba
 * mensual de docs/respaldos.md).
 *
 *   node scripts/probar-restauracion.mjs                          (el respaldo más nuevo de /data/backups)
 *   node scripts/probar-restauracion.mjs --archivo /data/backups/pg-dump-vocero-1760929200.dmp
 *   node scripts/probar-restauracion.mjs --servidor postgresql://…   (otro servidor de Postgres, no el de producción)
 *
 * En la imagen de Docker viaja como `/app/ops/probar-restauracion.mjs`:
 *   docker exec <contenedor de la app> node ops/probar-restauracion.mjs
 *
 * Acepta los respaldos de `ops/respaldo.mjs` (`.dump`) y los programados de
 * Coolify (`.dmp`): los dos son el formato propio de pg_dump. Un `.sql` de
 * texto se rechaza (podría cambiarse de base a media restauración).
 *
 * Candados (`assertBaseDePrueba`, scripts/lib/respaldos-core.mjs):
 * - El nombre de la base temporal lo genera el guion: siempre
 *   `vocero_prueba_restauracion_<fecha>`. No se puede elegir otro.
 * - Antes de crear, restaurar y borrar se comprueba que tenga ese prefijo y
 *   que no sea la base de producción.
 * - Se restaura con `--no-owner --no-acl`: la copia no da permisos a nadie.
 * - Al terminar (bien o mal) la base temporal se borra.
 *
 * Qué revisa: que se restaure sin errores; que traiga organizaciones;
 * cuántas migraciones trae frente a las de esta versión de la app; los
 * conteos de las tablas principales (junto a los de producción, si es el
 * mismo servidor); y si la ENCRYPTION_KEY de este contenedor abre los
 * secretos de la copia (solo comprueba: nunca muestra ni guarda lo descifrado).
 *
 * Conecta con DATABASE_URL_MIGRATE (el dueño `postgres`, que puede crear
 * bases); sin ella, con DATABASE_URL. Sale con código 0 solo si TODO pasa.
 */
import { spawn } from "node:child_process";
import { createDecipheriv, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import {
  assertBaseDePrueba,
  esFormatoPropio,
  libpqEnv,
  nombreBasePrueba,
  tamano,
  triosCifrados,
} from "./lib/respaldos-core.mjs";

const args = { dir: "/data/backups" };
const rest = process.argv.slice(2);
for (let i = 0; i < rest.length; i++) {
  const k = rest[i]?.replace(/^--/, "");
  if (k === "archivo") args.archivo = rest[++i];
  else if (k === "dir") args.dir = rest[++i];
  else if (k === "servidor") args.servidor = rest[++i];
  else uso(`opción desconocida: ${rest[i]}`);
}

function uso(msg) {
  if (msg) console.error(`Error: ${msg}`);
  console.error("Uso: probar-restauracion.mjs [--archivo ruta.dump|.dmp] [--dir carpeta] [--servidor postgresql://…]");
  process.exit(2);
}

const urlProduccion = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!urlProduccion) uso("falta DATABASE_URL_MIGRATE (o DATABASE_URL)");
const urlServidor = args.servidor || urlProduccion;

/** Las tablas cuyo conteo se enseña (solo números, nunca contenido). */
const PRINCIPALES = ["organization", "user", "member", "contact", "conversation", "message", "campaign", "campaign_recipient", "kb_document"];

const bin = (nombre) => (process.env.PG_BIN ? path.join(process.env.PG_BIN, nombre) : nombre);

function correr(cmd, argv, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stdout.resume();
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) =>
      reject(e.code === "ENOENT" ? new Error(`no se encontró «${cmd}» en esta imagen (¿falta postgresql18-client?)`) : e)
    );
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} terminó con código ${code}: ${err.trim().slice(0, 600)}`))
    );
  });
}

async function archivoAProbar() {
  if (args.archivo) return path.resolve(args.archivo);
  const nombres = (await readdir(args.dir)).filter((n) => /\.(dump|dmp)$/.test(n));
  if (nombres.length === 0) throw new Error(`no hay respaldos (.dump o .dmp) en ${args.dir}; usa --archivo`);
  const conFecha = await Promise.all(
    nombres.map(async (n) => ({ n, t: (await stat(path.join(args.dir, n))).mtimeMs }))
  );
  conFecha.sort((a, b) => b.t - a.t);
  return path.join(args.dir, conFecha[0].n);
}

async function revisarSuma(archivo) {
  const lateral = await readFile(`${archivo}.sha256`, "utf8").catch(() => null);
  if (!lateral) return "sin .sha256 al lado (normal en los de Coolify)";
  const esperada = lateral.trim().split(/\s+/)[0];
  const h = createHash("sha256");
  for await (const chunk of createReadStream(archivo)) h.update(chunk);
  if (h.digest("hex") !== esperada) throw new Error("el archivo no coincide con su .sha256: está dañado o incompleto");
  return "coincide con su .sha256";
}

/** El llavero de este contenedor (mismas variables que la app, src/lib/env.ts). */
function llavero() {
  const llaves = new Map();
  const poner = (raw, version) => {
    if (!raw) return;
    const key = Buffer.from(raw, "base64");
    if (key.length === 32) llaves.set(Number(version), key);
  };
  poner(process.env.ENCRYPTION_KEY, process.env.ENCRYPTION_KEY_VERSION || 1);
  if (process.env.ENCRYPTION_KEY_OLD_VERSION) poner(process.env.ENCRYPTION_KEY_OLD, process.env.ENCRYPTION_KEY_OLD_VERSION);
  return llaves;
}

/** ¿La llave abre este valor? AES-256-GCM verifica el tag; lo descifrado se descarta sin mirarlo. */
function llaveAbre(key, fila) {
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(fila.iv, "base64"));
    d.setAuthTag(Buffer.from(fila.tag, "base64"));
    d.update(Buffer.from(fila.cipher, "base64"));
    d.final();
    return true;
  } catch {
    return false;
  }
}

async function revisarLlave(db) {
  const llaves = llavero();
  if (llaves.size === 0) return { ok: false, texto: "no hay ENCRYPTION_KEY en este contenedor: no se pudo revisar" };
  const columnas = await db`
    select table_name, array_agg(column_name::text order by column_name) as cols
    from information_schema.columns where table_schema = 'public'
    group by table_name order by table_name`;
  let probadas = 0;
  const fallas = [];
  for (const { table_name: tabla, cols } of columnas) {
    for (const trio of triosCifrados(cols)) {
      const filas = await db`
        select ${db(trio.cipher)} as cipher, ${db(trio.iv)} as iv, ${db(trio.tag)} as tag, key_version
        from ${db(tabla)} where ${db(trio.cipher)} is not null limit 3`;
      for (const f of filas) {
        probadas++;
        const key = llaves.get(Number(f.key_version));
        if (!key) fallas.push(`${tabla}: cifrado con la llave versión ${f.key_version}, que este contenedor no tiene`);
        else if (!llaveAbre(key, f)) fallas.push(`${tabla}: la llave versión ${f.key_version} de este contenedor NO lo abre`);
      }
    }
  }
  if (probadas === 0) return { ok: true, texto: "la copia no tiene secretos cifrados (nada que revisar)" };
  if (fallas.length > 0) return { ok: false, texto: [...new Set(fallas)].join("; ") };
  return { ok: true, texto: `la llave actual abre los secretos de la copia (${probadas} revisado(s))` };
}

async function conteos(db) {
  const existentes = new Set(
    (await db`select table_name from information_schema.tables where table_schema = 'public'`).map((r) => r.table_name)
  );
  const out = {};
  for (const t of PRINCIPALES) {
    if (!existentes.has(t)) continue;
    const [r] = await db`select count(*)::bigint as n from ${db(t)}`;
    out[t] = Number(r.n);
  }
  return out;
}

async function migracionesDeLaApp() {
  const dirs = [process.env.MIGRATIONS_DIR, "/app/drizzle", path.resolve("drizzle")].filter(Boolean);
  for (const d of dirs) {
    const journal = await readFile(path.join(d, "meta", "_journal.json"), "utf8").catch(() => null);
    if (journal) return JSON.parse(journal).entries?.length ?? null;
  }
  return null;
}

async function main() {
  const archivo = await archivoAProbar();
  const { size } = await stat(archivo);
  const fh = await open(archivo, "r");
  const cabeza = Buffer.alloc(8);
  await fh.read(cabeza, 0, 8, 0);
  await fh.close();
  if (!esFormatoPropio(cabeza)) {
    throw new Error("el archivo no es un respaldo en formato propio de pg_dump (.dump/.dmp). Los .sql de texto no se prueban aquí.");
  }
  console.log(`Respaldo: ${archivo} (${tamano(size)}) — ${await revisarSuma(archivo)}`);

  const baseProduccion = libpqEnv(urlProduccion).PGDATABASE;
  const envServidor = libpqEnv(urlServidor);
  const mismoServidor = !args.servidor;
  const nombre = assertBaseDePrueba(nombreBasePrueba(), baseProduccion);
  if (nombre === envServidor.PGDATABASE) throw new Error("la base de prueba no puede ser la base a la que se conecta el guion");

  const admin = postgres(urlServidor, { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });
  let creada = false;
  const resultados = [];
  const marcar = (ok, texto) => {
    resultados.push(ok);
    console.log(`${ok ? "✔" : "✘"} ${texto}`);
  };
  try {
    await admin.unsafe(`create database "${assertBaseDePrueba(nombre, baseProduccion)}"`);
    creada = true;
    console.log(`Base temporal: ${nombre} (en ${envServidor.PGHOST}; se borra al terminar)`);

    const inicio = Date.now();
    await correr(
      bin("pg_restore"),
      ["--no-owner", "--no-acl", "--exit-on-error", "--dbname", assertBaseDePrueba(nombre, baseProduccion), archivo],
      { ...envServidor, PGDATABASE: nombre }
    );
    marcar(true, `Se restauró sin errores en ${Math.round((Date.now() - inicio) / 1000)} s`);

    const urlPrueba = new URL(urlServidor);
    urlPrueba.pathname = `/${nombre}`;
    const db = postgres(urlPrueba.toString(), { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });
    try {
      const copia = await conteos(db);
      marcar((copia.organization ?? 0) > 0, `Organizaciones en la copia: ${copia.organization ?? "no hay tabla"}`);

      const enApp = await migracionesDeLaApp();
      const [m] = await db`select to_regclass('drizzle.__drizzle_migrations') is not null as hay`;
      const enCopia = m?.hay ? Number((await db`select count(*)::int as n from drizzle.__drizzle_migrations`)[0].n) : null;
      if (enCopia === null) marcar(false, "La copia no trae la tabla de migraciones (drizzle.__drizzle_migrations)");
      else if (enApp === null) marcar(true, `Migraciones en la copia: ${enCopia} (no se encontró drizzle/ para comparar)`);
      else if (enCopia > enApp) {
        marcar(true, `Migraciones: la copia trae ${enCopia} y esta versión de la app conoce ${enApp} (la copia es de una versión MÁS NUEVA: restáurala con esa versión)`);
      } else {
        marcar(true, `Migraciones: la copia trae ${enCopia} de ${enApp}${enCopia < enApp ? " (es de una versión anterior: la app aplicará las que faltan al arrancar)" : ""}`);
      }

      const prod = mismoServidor ? await conteosProduccion() : null;
      console.log("  Conteos (copia" + (prod ? " · producción hoy" : "") + "):");
      for (const t of PRINCIPALES) {
        if (!(t in copia)) continue;
        console.log(`    ${t.padEnd(20)} ${String(copia[t]).padStart(9)}${prod && t in prod ? ` · ${String(prod[t]).padStart(9)}` : ""}`);
      }

      const llave = await revisarLlave(db);
      marcar(llave.ok, `Llave de cifrado: ${llave.texto}`);
    } finally {
      await db.end();
    }
  } finally {
    if (creada) {
      const n = assertBaseDePrueba(nombre, baseProduccion);
      await admin`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${n} and pid <> pg_backend_pid()`;
      await admin.unsafe(`drop database if exists "${n}"`);
      console.log(`· Base temporal ${n} borrada.`);
    }
    await admin.end();
  }

  const ok = resultados.length > 0 && resultados.every(Boolean);
  console.log(ok ? "\nPRUEBA APROBADA: este respaldo se puede restaurar." : "\nPRUEBA FALLIDA: revisa las líneas con ✘ (docs/respaldos.md, «Si la prueba falla»).");
  if (!ok) process.exitCode = 1;
}

/** Conteos de producción para comparar (solo números). Con el dueño: sin RLS que esconda filas. */
async function conteosProduccion() {
  const db = postgres(urlProduccion, { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });
  try {
    return await conteos(db);
  } catch {
    return null;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  console.error("PRUEBA FALLIDA.");
  process.exitCode = 1;
});
