/**
 * Consentimiento inicial — pasa a `opt_in` los contactos de WhatsApp de UNA
 * organización que hoy están en `desconocido`, con origen «migración
 * inicial». Herramienta del OPERADOR (decisión del dueño): una sola vez, al
 * adoptar la declaración de consentimiento al importar.
 *
 *   node scripts/set-consent-inicial.mjs --org <id>                    (solo muestra)
 *   node scripts/set-consent-inicial.mjs --org <id> --apply            (pide confirmar y aplica)
 *   node scripts/set-consent-inicial.mjs --org <id> --revert [--apply] (deshace)
 *
 * En la imagen de Docker viaja como `/app/ops/set-consent-inicial.mjs`:
 *   docker exec -it <contenedor de la app> node ops/set-consent-inicial.mjs --org …
 *
 * Reglas:
 * - `--org` es obligatorio: jamás «la primera organización».
 * - Sin `--apply` NO escribe nada: muestra cuántos cambiaría y 10 de ejemplo.
 * - Con `--apply` muestra lo mismo y pide escribir el número exacto. Sin
 *   terminal interactiva, aborta. Si el número cambió entre la cuenta y la
 *   escritura, aborta sin escribir nada (una sola transacción).
 * - NUNCA toca un `opt_out` ni un `opt_in`: solo `desconocido`.
 * - Excluye los contactos del Laboratorio (con conversación de prueba) y los
 *   de otros canales (Instagram, Messenger): las campañas son de WhatsApp.
 * - Cada cambio deja `consent_changed` en la línea de tiempo (fuente
 *   «sistema»). Correrlo otra vez cambia 0.
 * - `--revert` regresa a `desconocido` solo a los que SIGUEN en `opt_in` con
 *   origen «migración inicial» (si alguien los cambió después, no se tocan).
 *
 * Usa DATABASE_URL_SYSTEM (o DATABASE_URL) del contenedor.
 */
import { randomInt } from "node:crypto";
import { createInterface } from "node:readline/promises";
import postgres from "postgres";

const SOURCE = "migración inicial";
const args = { apply: false, revert: false };
const rest = process.argv.slice(2);
for (let i = 0; i < rest.length; i++) {
  const k = rest[i]?.replace(/^--/, "");
  if (k === "apply") args.apply = true;
  else if (k === "revert") args.revert = true;
  else if (k === "org") args.org = rest[++i];
  else uso(`opción desconocida: ${rest[i]}`);
}

function uso(msg) {
  if (msg) console.error(`Error: ${msg}`);
  console.error("Uso: set-consent-inicial.mjs --org <id> [--revert] [--apply]");
  process.exit(2);
}

if (!args.org || !/^[\w-]{3,64}$/.test(args.org)) uso("falta --org <id de la organización>");
const url = process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL;
if (!url) uso("falta DATABASE_URL_SYSTEM o DATABASE_URL");

const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });

/** Mismo formato que `newId("activityEvent")`: act_ + 20 de [0-9a-z]. */
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const actId = () => "act_" + Array.from({ length: 20 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/** Los contactos que cambiarían (dentro de `tx`, con la organización fijada). */
function candidatos(tx) {
  const from = args.revert ? "opt_in" : "desconocido";
  return tx`
    select c.id, c.name, coalesce(c.phone, c.wa_identity) as phone
    from contact c
    where c.organization_id = ${args.org}
      and c.channel = 'whatsapp'
      and c.wa_consent = ${from}
      ${args.revert ? tx`and c.wa_consent_source = ${SOURCE}` : tx``}
      and not exists (
        select 1 from conversation v
        where v.organization_id = c.organization_id and v.contact_id = c.id and v.is_test
      )
    order by c.created_at, c.id
  `;
}

async function enOrganizacion(fn) {
  return sql.begin(async (tx) => {
    // Por si la URL es la de la app (RLS): la organización del contexto.
    await tx`select set_config('app.org_id', ${args.org}, true)`;
    return fn(tx);
  });
}

async function confirmar(n) {
  if (!process.stdin.isTTY) {
    console.error("\nSin terminal interactiva no se aplica: corre con `docker exec -it …`.");
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nPara aplicar, escribe el número de contactos que cambiarán (${n}): `);
  rl.close();
  return answer.trim() === String(n);
}

async function main() {
  const [org] = await enOrganizacion((tx) => tx`select id, name from organization where id = ${args.org}`);
  if (!org) {
    console.error(`No existe la organización ${args.org}.`);
    process.exitCode = 1;
    return;
  }
  const accion = args.revert
    ? `regresar a «desconocido» los opt_in con origen «${SOURCE}»`
    : `pasar a «opt_in» (origen «${SOURCE}») los «desconocido»`;
  console.log(`Organización: ${org.name} (${org.id})`);
  console.log(`Acción: ${accion}\n`);

  const { porEstado, lista } = await enOrganizacion(async (tx) => ({
    porEstado: await tx`
      select wa_consent, count(*)::int as n from contact
      where organization_id = ${args.org} and channel = 'whatsapp'
      group by wa_consent order by wa_consent
    `,
    lista: await candidatos(tx),
  }));
  console.log("Contactos de WhatsApp hoy:");
  for (const r of porEstado) console.log(`  ${r.wa_consent.padEnd(12)} ${r.n}`);
  console.log(`\nCambiarían: ${lista.length} (los opt_out no se tocan; Laboratorio excluido)`);
  for (const c of lista.slice(0, 10)) console.log(`  - ${c.name ?? "(sin nombre)"} · ${c.phone}`);
  if (lista.length > 10) console.log(`  … y ${lista.length - 10} más`);

  if (lista.length === 0) {
    console.log("\nNada que cambiar.");
    return;
  }
  if (!args.apply) {
    console.log("\nNo se escribió nada. Para aplicar, repite con --apply.");
    return;
  }
  if (!(await confirmar(lista.length))) {
    console.log("No coincide: no se aplicó nada.");
    process.exitCode = 1;
    return;
  }

  const from = args.revert ? "opt_in" : "desconocido";
  const to = args.revert ? "desconocido" : "opt_in";
  const changed = await enOrganizacion(async (tx) => {
    const ahora = await candidatos(tx);
    if (ahora.length !== lista.length) {
      throw new Error(`el número cambió (${lista.length} → ${ahora.length}): vuelve a correrlo para revisar`);
    }
    const ids = ahora.map((c) => c.id);
    const updated = await tx`
      update contact set
        wa_consent = ${to},
        wa_consent_source = ${args.revert ? `reversa de ${SOURCE}` : SOURCE},
        wa_consent_at = now(),
        updated_at = now()
      where organization_id = ${args.org} and id = any(${ids}) and wa_consent = ${from}
      returning id
    `;
    if (updated.length !== ids.length) throw new Error("un contacto cambió durante la escritura: no se aplicó nada");
    const detail = { from, to, source: args.revert ? `reversa de ${SOURCE}` : SOURCE };
    for (let i = 0; i < ids.length; i += 500) {
      const rows = ids.slice(i, i + 500).map((id) => ({
        id: actId(),
        organization_id: args.org,
        contact_id: id,
        kind: "consent_changed",
        actor_user_id: null,
        source: "sistema",
        detail: sql.json(detail),
      }));
      await tx`insert into contact_activity_event ${tx(rows)}`;
    }
    return updated.length;
  });
  console.log(`\nListo: ${changed} contacto(s) ahora en «${to}», cada uno con su línea en la bitácora.`);
}

main()
  .catch((err) => {
    console.error(`\nError: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
