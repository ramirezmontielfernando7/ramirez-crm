/**
 * 035 — Límites de los Documentos del agente por organización.
 * Herramienta del OPERADOR de la plataforma.
 *
 *   node --env-file=.env scripts/kb-limits.mjs show [--org org_…]
 *   node --env-file=.env scripts/kb-limits.mjs set  --org org_… [--file-mb N|none] [--documents N|none] [--chunks N|none] [--dry-run]
 *
 * `show` lista los límites y el uso de cada organización. `set` fija los
 * límites PROPIOS de una organización (`none` = sin límite propio: vale el del
 * entorno, KB_DOCS_MAX_FILE_MB / KB_DOCS_MAX_DOCUMENTS / KB_DOCS_MAX_CHUNKS, o
 * 5 MB / 50 / 3 000). Antes de escribir muestra lo que va a cambiar; con
 * `--dry-run` solo lo muestra. Bajar un límite no borra nada: solo impide
 * subir más. Usa el rol de sistema (DATABASE_URL_SYSTEM) si existe. En la
 * imagen de Docker viaja como `/app/ops/kb-limits.mjs`
 * (docker exec … node ops/kb-limits.mjs).
 */
import postgres from "postgres";

const [, , cmd, ...rest] = process.argv;
const args = {};
for (let i = 0; i < rest.length; i++) {
  const k = rest[i]?.replace(/^--/, "");
  if (k === "dry-run") args[k] = true;
  else args[k] = rest[++i];
}

function uso(msg) {
  if (msg) console.error(`Error: ${msg}`);
  console.error(
    "Uso: kb-limits.mjs show [--org org_…] | set --org org_… [--file-mb N|none] [--documents N|none] [--chunks N|none] [--dry-run]"
  );
  process.exit(2);
}

/** `none` → null; un número > 0 → número; otra cosa → error. `undefined` = no tocar. */
function limite(v, nombre, { decimal = false } = {}) {
  if (v === undefined) return undefined;
  if (v === "none") return null;
  if (!(decimal ? /^\d+(\.\d+)?$/ : /^\d+$/).test(v) || Number(v) <= 0) uso(`--${nombre} debe ser un número mayor que 0 o "none"`);
  return Number(v);
}

const url = process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL;
if (!url) uso("falta DATABASE_URL");
if (!["show", "set"].includes(cmd)) uso();

const env = {
  fileMb: Number(process.env.KB_DOCS_MAX_FILE_MB || 5),
  documents: Number(process.env.KB_DOCS_MAX_DOCUMENTS || 50),
  chunks: Number(process.env.KB_DOCS_MAX_CHUNKS || 3000),
};
const mb = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;
const fmt = (propio, def, unidad = "") => (propio !== null && propio !== undefined ? `${propio}${unidad}` : `${def}${unidad} (default)`);

const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });
let code = 0;
try {
  if (cmd === "show") {
    const filas = await sql`
      select o.id, o.name, l.max_file_bytes, l.max_documents, l.max_chunks,
        (select count(*)::int from kb_document d where d.organization_id = o.id) as docs,
        (select coalesce(sum(chunk_count), 0)::int from kb_document d where d.organization_id = o.id) as chunks
      from "organization" o
      left join kb_document_limit l on l.organization_id = o.id
      where ${args.org ? sql`o.id = ${args.org}` : sql`true`}
      order by o.created_at`;
    for (const f of filas) {
      console.log(
        `${f.id}  «${f.name}»  archivo ${fmt(f.max_file_bytes === null ? null : mb(f.max_file_bytes), env.fileMb, " MB")}` +
          `  ·  documentos ${f.docs} / ${fmt(f.max_documents, env.documents)}  ·  fragmentos ${f.chunks} / ${fmt(f.max_chunks, env.chunks)}`
      );
    }
    if (filas.length === 0) console.log("(sin organizaciones)");
  } else {
    if (!args.org) uso("falta --org");
    const fileMb = limite(args["file-mb"], "file-mb", { decimal: true });
    const documents = limite(args.documents, "documents");
    const chunks = limite(args.chunks, "chunks");
    if (fileMb === undefined && documents === undefined && chunks === undefined) uso("di qué cambiar: --file-mb, --documents y/o --chunks");
    if (fileMb && fileMb > 50) uso("--file-mb no puede pasar de 50");
    const [org] = await sql`select id, name from "organization" where id = ${args.org}`;
    if (!org) throw new Error(`la organización ${args.org} no existe`);
    const [antes] = await sql`select max_file_bytes, max_documents, max_chunks from kb_document_limit where organization_id = ${org.id}`;
    const nuevo = {
      bytes: fileMb === undefined ? (antes?.max_file_bytes ?? null) : fileMb === null ? null : Math.round(fileMb * 1024 * 1024),
      documents: documents === undefined ? (antes?.max_documents ?? null) : documents,
      chunks: chunks === undefined ? (antes?.max_chunks ?? null) : chunks,
    };
    const verMb = (b) => (b === null || b === undefined ? null : mb(b));
    console.log(`Organización «${org.name}» (${org.id})`);
    console.log(`  archivo:    ${fmt(verMb(antes?.max_file_bytes), env.fileMb, " MB")}  →  ${fmt(verMb(nuevo.bytes), env.fileMb, " MB")}`);
    console.log(`  documentos: ${fmt(antes?.max_documents, env.documents)}  →  ${fmt(nuevo.documents, env.documents)}`);
    console.log(`  fragmentos: ${fmt(antes?.max_chunks, env.chunks)}  →  ${fmt(nuevo.chunks, env.chunks)}`);
    if (args["dry-run"]) {
      console.log("--dry-run: no se escribió nada.");
    } else {
      // Pool de sistema sin organización en el contexto: la política de RLS
      // no aplica a vocero_system (BYPASSRLS), igual que ai-quota.mjs.
      await sql`
        insert into kb_document_limit (organization_id, max_file_bytes, max_documents, max_chunks, updated_at)
        values (${org.id}, ${nuevo.bytes}, ${nuevo.documents}, ${nuevo.chunks}, now())
        on conflict (organization_id) do update
          set max_file_bytes = excluded.max_file_bytes,
              max_documents = excluded.max_documents,
              max_chunks = excluded.max_chunks,
              updated_at = now()`;
      console.log("Guardado. Aplica desde la siguiente subida.");
    }
  }
} catch (err) {
  console.error(`Error: ${err?.message ?? err}`);
  code = 1;
} finally {
  await sql.end();
}
process.exit(code);
