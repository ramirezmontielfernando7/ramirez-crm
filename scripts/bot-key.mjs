/**
 * Fase 1 multitenant (H2) — llaves del cerebro externo (`/api/bot/*`), una
 * organización por llave. Herramienta del OPERADOR de la plataforma: no hay
 * pantalla para crearlas (hoy el cerebro externo es solo de la organización
 * de la plataforma).
 *
 *   node --env-file=.env scripts/bot-key.mjs create --org org_… [--name "Nea"]
 *   node --env-file=.env scripts/bot-key.mjs list   [--org org_…]
 *   node --env-file=.env scripts/bot-key.mjs revoke --org org_… [--id bak_…]
 *
 * `create` imprime la llave UNA sola vez (se guarda solo su SHA-256, igual
 * que src/server/bot/keys.ts). `revoke` sin `--id` revoca todas las de la
 * organización. En el contenedor: `docker exec -it <app> node scripts/bot-key.mjs …`
 * (DATABASE_URL_SYSTEM o DATABASE_URL ya vienen en su entorno: administrar
 * llaves es trabajo de plataforma y usa el rol de sistema si existe).
 */
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

const [, , cmd, ...rest] = process.argv;
const args = {};
for (let i = 0; i < rest.length; i += 2) args[rest[i]?.replace(/^--/, "")] = rest[i + 1];

function uso(msg) {
  if (msg) console.error(`Error: ${msg}`);
  console.error("Uso: bot-key.mjs create --org org_… [--name texto] | list [--org org_…] | revoke --org org_… [--id bak_…]");
  process.exit(2);
}

const url = process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL;
if (!url) uso("falta DATABASE_URL");
if (!["create", "list", "revoke"].includes(cmd)) uso();

const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });
let code = 0;
try {
  if (cmd === "create") {
    if (!args.org) uso("falta --org");
    const [org] = await sql`select id, name from "organization" where id = ${args.org}`;
    if (!org) throw new Error(`la organización ${args.org} no existe`);
    const key = "vbk_" + randomBytes(32).toString("base64url");
    const id = "bak_" + randomBytes(10).toString("hex");
    await sql`
      insert into "bot_api_key" (id, organization_id, name, key_prefix, key_hash, source)
      values (${id}, ${org.id}, ${args.name ?? "cerebro externo"}, ${key.slice(0, 8)},
              ${createHash("sha256").update(key, "utf8").digest("hex")}, 'script')`;
    console.log(`Llave ${id} creada para «${org.name}» (${org.id}). Cópiala ahora; no se vuelve a mostrar:`);
    console.log(key);
  } else if (cmd === "list") {
    const filas = args.org
      ? await sql`select id, organization_id, name, key_prefix, source, created_at, last_used_at, revoked_at from "bot_api_key" where organization_id = ${args.org} order by created_at`
      : await sql`select id, organization_id, name, key_prefix, source, created_at, last_used_at, revoked_at from "bot_api_key" order by organization_id, created_at`;
    for (const f of filas) {
      console.log(
        [f.id, f.organization_id, `${f.key_prefix}…`, f.source, f.name,
          `creada ${f.created_at.toISOString()}`,
          f.last_used_at ? `usada ${f.last_used_at.toISOString()}` : "sin uso",
          f.revoked_at ? `REVOCADA ${f.revoked_at.toISOString()}` : "activa"].join("  ")
      );
    }
    if (filas.length === 0) console.log("(sin llaves)");
  } else {
    if (!args.org) uso("falta --org");
    const filas = args.id
      ? await sql`update "bot_api_key" set revoked_at = now() where organization_id = ${args.org} and id = ${args.id} and revoked_at is null returning id`
      : await sql`update "bot_api_key" set revoked_at = now() where organization_id = ${args.org} and revoked_at is null returning id`;
    console.log(`${filas.length} llave(s) revocada(s).`);
  }
} catch (err) {
  console.error(`Error: ${err?.message ?? err}`);
  code = 1;
} finally {
  await sql.end();
}
process.exit(code);
