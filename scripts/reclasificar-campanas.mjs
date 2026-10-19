/**
 * 041 — Reclasifica los chats de campaña que ya existían antes de la 0051.
 * Herramienta del OPERADOR: se corre a mano, una vez, cuando el dueño lo
 * autoriza (y después de una copia de seguridad).
 *
 *   node scripts/reclasificar-campanas.mjs --org <id>           (solo cuenta)
 *   node scripts/reclasificar-campanas.mjs --all                (solo cuenta, todas)
 *   node scripts/reclasificar-campanas.mjs --org <id> --apply   (pide confirmar y aplica)
 *   node scripts/reclasificar-campanas.mjs --all --apply
 *
 * Qué hace con cada chat que recibió al menos un mensaje de campaña y aún
 * no tiene marca (`scripts/lib/reclasificar-campanas-core.mjs`):
 * - el contacto nunca escribió → pestaña «Campañas» (campaña más reciente);
 * - escribió después de la primera campaña → se queda en la Bandeja con
 *   «Respondió a campaña X»;
 * - ya escribía antes de la primera campaña → no se toca.
 *
 * Reglas:
 * - `--org` o `--all` obligatorio: jamás «la primera organización».
 * - Sin `--apply` NO escribe nada: cuenta y muestra 10 de ejemplo.
 * - Con `--apply` pide escribir el número exacto de chats que cambiarán. Sin
 *   terminal interactiva, aborta. Cada organización en UNA transacción.
 * - Aditivo: solo llena columnas vacías de chats sin marca; no borra nada.
 *   Correrlo dos veces cambia 0 la segunda vez.
 *
 * Usa DATABASE_URL_SYSTEM (o DATABASE_URL).
 */
import { createInterface } from "node:readline/promises";
import postgres from "postgres";
import { applyReclassify, planReclassify } from "./lib/reclasificar-campanas-core.mjs";

const args = { apply: false, all: false };
const rest = process.argv.slice(2);
for (let i = 0; i < rest.length; i++) {
  const k = rest[i]?.replace(/^--/, "");
  if (k === "apply") args.apply = true;
  else if (k === "all") args.all = true;
  else if (k === "org") args.org = rest[++i];
  else uso(`opción desconocida: ${rest[i]}`);
}

function uso(msg) {
  if (msg) console.error(`Error: ${msg}`);
  console.error("Uso: reclasificar-campanas.mjs (--org <id> | --all) [--apply]");
  process.exit(2);
}

if (args.all === Boolean(args.org)) uso("usa --org <id> o --all (uno de los dos)");
if (args.org && !/^[\w-]{3,64}$/.test(args.org)) uso("--org no parece un id de organización");
const url = process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL;
if (!url) uso("falta DATABASE_URL_SYSTEM o DATABASE_URL");

const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });

async function enOrganizacion(org, fn) {
  return sql.begin(async (tx) => {
    // Por si la URL es la de la app (RLS): la organización del contexto.
    await tx`select set_config('app.org_id', ${org}, true)`;
    return fn(tx);
  });
}

async function confirmar(n) {
  if (!process.stdin.isTTY) {
    console.error("\nSin terminal interactiva no se aplica: corre con `docker exec -it …`.");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nPara aplicar, escribe el número de chats que cambiarán (${n}): `);
  rl.close();
  return answer.trim() === String(n);
}

async function main() {
  const orgs = args.all
    ? await sql`select id, name from organization order by created_at, id`
    : await sql`select id, name from organization where id = ${args.org}`;
  if (orgs.length === 0) {
    console.error(args.all ? "No hay organizaciones." : `No existe la organización ${args.org}.`);
    process.exitCode = 1;
    return;
  }

  const planes = [];
  let total = 0;
  for (const org of orgs) {
    const plan = await enOrganizacion(org.id, (tx) => planReclassify(tx, org.id));
    const n = plan.pending.length + plan.replied.length;
    if (n === 0 && args.all) continue;
    console.log(`\n${org.name} (${org.id})`);
    console.log(`  a «Campañas» (nunca respondieron):        ${plan.pending.length}`);
    console.log(`  con «Respondió a campaña» (en la Bandeja): ${plan.replied.length}`);
    console.log(`  sin tocar (ya escribían antes):           ${plan.active}`);
    for (const p of plan.pending.slice(0, 10)) console.log(`    - ${p.id} → Campañas (${p.campaignId})`);
    if (plan.pending.length > 10) console.log(`    … y ${plan.pending.length - 10} más`);
    planes.push({ org, plan });
    total += n;
  }

  if (total === 0) {
    console.log("\nNada que cambiar.");
    return;
  }
  console.log(`\nEn total cambiarían ${total} chat(s).`);
  if (!args.apply) {
    console.log("No se escribió nada. Para aplicar, repite con --apply (después de la copia de seguridad).");
    return;
  }
  if (!(await confirmar(total))) {
    console.log("No coincide: no se aplicó nada.");
    process.exitCode = 1;
    return;
  }

  let hechos = 0;
  for (const { org, plan } of planes) {
    const r = await enOrganizacion(org.id, (tx) => applyReclassify(tx, org.id, plan));
    hechos += r.pending + r.replied;
    console.log(`  ${org.name}: ${r.pending} a «Campañas», ${r.replied} con «Respondió a campaña».`);
  }
  console.log(`\nListo: ${hechos} chat(s) reclasificados. Correrlo otra vez no cambia nada.`);
}

main()
  .catch((err) => {
    console.error(`\nError: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
