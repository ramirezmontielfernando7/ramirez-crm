/**
 * Fase 3, PR 1 — cuota mensual de IA por organización (mes calendario UTC).
 * Herramienta del OPERADOR de la plataforma (en el PR 2 pasa a /platform).
 *
 *   node --env-file=.env scripts/ai-quota.mjs show [--org org_…]
 *   node --env-file=.env scripts/ai-quota.mjs set  --org org_… [--turns N|none] [--tokens N|none] [--dry-run]
 *
 * `show` lista topes y consumo del mes. `set` fija los topes PROPIOS de una
 * organización (`none` = sin tope propio: vale el default del entorno,
 * AI_DEFAULT_MONTHLY_TURNS / AI_DEFAULT_MONTHLY_TOKENS; sin default, sin
 * tope). Antes de escribir muestra lo que va a cambiar; con `--dry-run` solo
 * lo muestra. Usa el rol de sistema (DATABASE_URL_SYSTEM) si existe: es
 * trabajo de plataforma, sobre cualquier organización. En la imagen de
 * Docker viaja como `/app/ops/ai-quota.mjs` (docker exec … node ops/ai-quota.mjs).
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
  console.error("Uso: ai-quota.mjs show [--org org_…] | set --org org_… [--turns N|none] [--tokens N|none] [--dry-run]");
  process.exit(2);
}

/** `none` → null; un entero ≥ 0 → número; otra cosa → error. `undefined` = no tocar. */
function limite(v, nombre) {
  if (v === undefined) return undefined;
  if (v === "none") return null;
  if (!/^\d+$/.test(v)) uso(`--${nombre} debe ser un entero ≥ 0 o "none"`);
  const n = Number(v);
  if (n > 2_147_483_647) uso(`--${nombre} es demasiado grande`);
  return n;
}

const url = process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL;
if (!url) uso("falta DATABASE_URL");
if (!["show", "set"].includes(cmd)) uso();

const periodo = (() => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
})();
const envTurns = process.env.AI_DEFAULT_MONTHLY_TURNS || null;
const envTokens = process.env.AI_DEFAULT_MONTHLY_TOKENS || null;
const fmt = (propio, def) => (propio !== null && propio !== undefined ? String(propio) : def ? `${def} (default)` : "sin tope");

const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });
let code = 0;
try {
  if (cmd === "show") {
    const filas = await sql`
      select o.id, o.name, q.monthly_turn_limit as turns, q.monthly_token_limit as tokens,
        u.turns as usados, coalesce(u.prompt_tokens + u.completion_tokens, 0) as gastados
      from "organization" o
      left join "ai_quota" q on q.organization_id = o.id
      left join "ai_usage" u on u.organization_id = o.id and u.period = ${periodo} and u.kind = 'total'
      where ${args.org ? sql`o.id = ${args.org}` : sql`true`}
      order by o.created_at`;
    console.log(`Mes ${periodo} (UTC)`);
    for (const f of filas) {
      console.log(
        `${f.id}  «${f.name}»  turnos ${f.usados ?? 0} / ${fmt(f.turns, envTurns)}  ·  tokens ${f.gastados} / ${fmt(f.tokens, envTokens)}`
      );
    }
    if (filas.length === 0) console.log("(sin organizaciones)");
  } else {
    if (!args.org) uso("falta --org");
    const turns = limite(args.turns, "turns");
    const tokens = limite(args.tokens, "tokens");
    if (turns === undefined && tokens === undefined) uso("di qué cambiar: --turns y/o --tokens");
    const [org] = await sql`select id, name from "organization" where id = ${args.org}`;
    if (!org) throw new Error(`la organización ${args.org} no existe`);
    const [antes] = await sql`select monthly_turn_limit as turns, monthly_token_limit as tokens from "ai_quota" where organization_id = ${org.id}`;
    const nuevoTurns = turns === undefined ? (antes?.turns ?? null) : turns;
    const nuevoTokens = tokens === undefined ? (antes?.tokens ?? null) : tokens;
    console.log(`Organización «${org.name}» (${org.id})`);
    console.log(`  turnos/mes: ${fmt(antes?.turns ?? null, envTurns)}  →  ${fmt(nuevoTurns, envTurns)}`);
    console.log(`  tokens/mes: ${fmt(antes?.tokens ?? null, envTokens)}  →  ${fmt(nuevoTokens, envTokens)}`);
    if (args["dry-run"]) {
      console.log("--dry-run: no se escribió nada.");
    } else {
      await sql`
        insert into "ai_quota" (organization_id, monthly_turn_limit, monthly_token_limit, updated_at)
        values (${org.id}, ${nuevoTurns}, ${nuevoTokens}, now())
        on conflict (organization_id) do update
          set monthly_turn_limit = excluded.monthly_turn_limit,
              monthly_token_limit = excluded.monthly_token_limit,
              updated_at = now()`;
      console.log("Guardado. Aplica desde el siguiente turno de IA.");
    }
  }
} catch (err) {
  console.error(`Error: ${err?.message ?? err}`);
  code = 1;
} finally {
  await sql.end();
}
process.exit(code);
