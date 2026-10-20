/**
 * Self-test E2E de Operación 1 (spec 043, apagado.md) — APAGADO LIMPIO con la
 * app COMPILADA (el `server.js` standalone, el mismo que corre la imagen) y
 * un SIGTERM de verdad a mitad de una campaña.
 *
 * Fase A — apagado limpio:
 *   una campaña envía (el wa-mock tarda 700 ms por envío: terminación 55500);
 *   SIGTERM a media llamada → /api/health responde 503; un webhook que llega
 *   durante el apagado se acusa (200) Y se procesa; el proceso sale con 0 en
 *   menos de SHUTDOWN_GRACE_MS; ningún destinatario queda `sending`; la
 *   concesión del número queda libre.
 * Fase B — el contenedor nuevo sigue: termina la campaña sin duplicar ni
 *   perder a nadie (un mensaje por destinatario, wamids distintos).
 * Fase C — Meta colgado (terminación 77700, 25 s): a los 20 s el envío se da
 *   por fallido «no se sabe si salió» y NO se reintenta (el mock lo recibió
 *   una sola vez).
 *
 * Uso (con la app YA compilada con `pnpm build`, la BD migrada y nada
 * escuchando en el puerto de APP_BASE_URL; este guion arranca y apaga la app):
 *   node --env-file=.env scripts/e2e-apagado.mjs
 *
 * Necesita en el entorno los mocks (WA_MOCK_ENABLED=true, ALLOW_CI_MOCKS=true,
 * APP_BASE_URL en localhost) y DATABASE_URL_MIGRATE (el dueño) para preparar
 * los datos. Crea su propia organización y la borra al final. Sale con 1 si
 * algo falla.
 */
import { spawn } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PORT = new URL(BASE).port || "3000";
const RUN = Date.now().toString(36);
const ORG = `org_apagado_${RUN}`;
const PN = `PN-APAGADO-${RUN}`;
const WABA = `WABA-APAGADO-${RUN}`;
const SERVER = path.resolve(".next/standalone/server.js");
const GRACE_MS = 25_000;

let failures = 0;
let checks = 0;
function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${String(extra).slice(0, 600)}` : ""}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 30_000, paso = 200) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}

const dbUrl = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("Falta DATABASE_URL_MIGRATE (o DATABASE_URL).");
  process.exit(2);
}
if (!existsSync(SERVER)) {
  console.error(`No existe ${SERVER}: corre «pnpm build» primero.`);
  process.exit(2);
}
const sql = postgres(dbUrl, { max: 2, onnotice: () => {}, connection: { TimeZone: "UTC" } });

/** Sella como `src/lib/crypto` (AES-256-GCM, llave versión 1). */
function sellar(plain) {
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return { cipher: enc.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64") };
}

/** Un teléfono mexicano de prueba que termina en `sufijo` (5 dígitos). */
const telefono = (sufijo) => `52${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}${sufijo}`;

async function preparar() {
  await sql`insert into organization (id, name, slug) values (${ORG}, ${"Apagado " + RUN}, ${"apagado-" + RUN})`;
  await sql`insert into organization_module (organization_id, campaigns, campaign_send_rate) values (${ORG}, true, 20)`;
  await sql`insert into whatsapp_business_account (id, organization_id, waba_id) values (${"wb_" + RUN}, ${ORG}, ${WABA})`;
  const t = sellar("token-e2e-apagado");
  await sql`
    insert into meta_credentials (id, organization_id, waba_id, phone_number_id, token_cipher, token_iv, token_tag)
    values (${"mc_" + RUN}, ${ORG}, ${WABA}, ${PN}, ${t.cipher}, ${t.iv}, ${t.tag})`;
  await sql`
    insert into template (id, organization_id, name, language, category, body, status)
    values (${"tpl_" + RUN}, ${ORG}, ${"apagado_" + RUN}, 'es_MX', 'UTILITY', 'Hola {{1}}', 'approved')`;
}

async function campana(nombre, sufijos) {
  const id = `cmp_${nombre}_${RUN}`;
  await sql`
    insert into campaign (id, organization_id, template_id, name, status, phone_number_id, started_at, total)
    values (${id}, ${ORG}, ${"tpl_" + RUN}, ${nombre}, 'sending', ${PN}, now(), ${sufijos.length})`;
  for (const [i, sufijo] of sufijos.entries()) {
    const phone = telefono(sufijo);
    const contactId = `ct_${nombre}_${i}_${RUN}`;
    await sql`
      insert into contact (id, organization_id, name, wa_identity, phone, wa_consent)
      values (${contactId}, ${ORG}, ${"C" + i}, ${phone}, ${phone}, 'opt_in')`;
    await sql`
      insert into campaign_recipient (id, organization_id, campaign_id, contact_id, contact_name, phone, variables)
      values (${`cr_${nombre}_${i}_${RUN}`}, ${ORG}, ${id}, ${contactId}, ${"C" + i}, ${phone}, ${sql.json(["C" + i])})`;
  }
  return id;
}

async function conteos(campaignId) {
  const rows = await sql`select status, count(*)::int as n from campaign_recipient where campaign_id = ${campaignId} group by status`;
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

function arrancar(nombre) {
  const log = [];
  const env = {
    ...process.env,
    PORT,
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    NEXT_MANUAL_SIG_HANDLE: "true",
    CAMPAIGN_TICK_MS: "1000",
    META_GRAPH_BASE_URL: `${BASE}/api/dev/wa-mock/graph`,
  };
  const child = spawn(process.execPath, [SERVER], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  const salida = new Promise((res) => child.on("exit", (code, signal) => res({ code, signal, at: Date.now() })));
  return { child, salida, log: () => log.join(""), nombre };
}

async function sano() {
  try {
    const r = await fetch(`${BASE}/api/health`);
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  await preparar();
  console.log(`Organización de prueba: ${ORG}`);

  // ---- Fase A: apagado limpio a mitad de la campaña --------------------------
  console.log("\nFase A — SIGTERM a mitad de una campaña");
  const N = 10;
  const cA = await campana("a", Array.from({ length: N }, () => "55500"));
  const app1 = arrancar("app1");
  ok("la app arranca", await hasta(sano, 90_000, 500), app1.log().slice(-1500));
  ok("la campaña empieza a enviar", await hasta(async () => ((await conteos(cA)).sent ?? 0) >= 2, 60_000), JSON.stringify(await conteos(cA)));

  const t0 = Date.now();
  app1.child.kill("SIGTERM");
  await sleep(150);
  const h = await fetch(`${BASE}/api/health`).then(
    async (r) => ({ status: r.status, body: await r.json().catch(() => null) }),
    () => null
  );
  ok("durante el apagado /api/health responde 503 shutting_down", h?.status === 503 && h.body?.error?.code === "shutting_down", JSON.stringify(h));

  // Un webhook que llega mientras se apaga: se acusa y SÍ se procesa.
  const desde = telefono("12345");
  const wamidIn = `wamid.apagado.in.${RUN}`;
  const wh = await fetch(`${BASE}/api/dev/wa-mock/inbound`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumberId: PN, from: desde, name: "Cliente", text: "hola durante el apagado", waMessageId: wamidIn }),
  }).then((r) => r.status, () => 0);
  ok("el webhook durante el apagado se acusa (200)", wh === 200, `status ${wh}`);

  const fin = await Promise.race([app1.salida, sleep(GRACE_MS + 10_000).then(() => null)]);
  ok("el proceso sale solo, con código 0", fin?.code === 0, JSON.stringify(fin) + "\n" + app1.log().slice(-1500));
  const dur = fin ? fin.at - t0 : Infinity;
  ok(`y antes del tope (${GRACE_MS / 1000} s): ${Math.round(dur / 100) / 10} s`, dur < GRACE_MS + 2_000);
  ok("el log dice «apagado limpio terminado» a tiempo", /apagado limpio terminado.*a_tiempo=true/.test(app1.log()), app1.log().slice(-1500));
  if (!fin) app1.child.kill("SIGKILL");

  const trasA = await conteos(cA);
  ok("ningún destinatario quedó «sending»", !trasA.sending, JSON.stringify(trasA));
  ok("se envió parte y quedó parte pendiente", (trasA.sent ?? 0) >= 2 && (trasA.pending ?? 0) > 0, JSON.stringify(trasA));
  const leases = await sql`select owner from wa_send_lease where organization_id = ${ORG}`;
  ok("la concesión del número quedó libre", leases.length === 0, JSON.stringify(leases));
  const [inbound] = await sql`select id from message where organization_id = ${ORG} and wa_message_id = ${wamidIn}`;
  ok("el mensaje del webhook se guardó antes de salir", Boolean(inbound));

  // ---- Fase B: el contenedor nuevo termina sin duplicar ----------------------
  console.log("\nFase B — el contenedor nuevo retoma");
  const app2 = arrancar("app2");
  ok("la app arranca otra vez", await hasta(sano, 90_000, 500), app2.log().slice(-1500));
  ok(
    "la campaña termina",
    await hasta(async () => (await sql`select status from campaign where id = ${cA}`)[0]?.status === "completed", 60_000),
    JSON.stringify(await conteos(cA))
  );
  ok("los 10 enviados, ninguno fallido", JSON.stringify(await conteos(cA)) === JSON.stringify({ sent: N }), JSON.stringify(await conteos(cA)));
  const [dup] = await sql`
    select count(*)::int as mensajes, count(distinct m.wa_message_id)::int as wamids, count(distinct c.contact_id)::int as contactos
    from message m join conversation c on c.id = m.conversation_id
    where m.organization_id = ${ORG} and m.direction = 'out' and c.contact_id in (select contact_id from campaign_recipient where campaign_id = ${cA})`;
  ok("un mensaje por destinatario: sin duplicados ni pérdidas", dup.mensajes === N && dup.wamids === N && dup.contactos === N, JSON.stringify(dup));

  // ---- Fase C: Meta colgado → fallido sin reintento --------------------------
  console.log("\nFase C — Meta no responde (tope de 20 s)");
  const cC = await campana("c", ["77700"]);
  const [rc] = await sql`select phone from campaign_recipient where campaign_id = ${cC}`;
  ok(
    "a los 20 s el envío queda fallido «no se sabe si salió»",
    await hasta(async () => (await conteos(cC)).failed === 1, 45_000, 500),
    JSON.stringify(await conteos(cC))
  );
  const [r] = await sql`select error_message, attempts, message_id from campaign_recipient where campaign_id = ${cC}`;
  ok("con el motivo de tiempo agotado", /no respondió a tiempo/.test(r?.error_message ?? ""), r?.error_message);
  const [m] = r?.message_id ? await sql`select status, wa_message_id from message where id = ${r.message_id}` : [];
  ok("y su mensaje queda fallido (no se borra la reserva)", m?.status === "failed" && m.wa_message_id === null, JSON.stringify(m));
  await sleep(8_000); // cuando Meta por fin «responde», el mock lo anota
  const outbox = await fetch(`${BASE}/api/dev/wa-mock/outbox`).then((x) => x.json());
  const aEse = (outbox.outbox ?? []).filter((o) => o.to === rc.phone).length;
  ok("Meta lo recibió UNA vez: no se reintentó", aEse === 1, `envíos al número: ${aEse}`);
  ok("la campaña termina (sin reintentos pendientes)", (await sql`select status from campaign where id = ${cC}`)[0]?.status === "completed");

  app2.child.kill("SIGTERM");
  const fin2 = await Promise.race([app2.salida, sleep(GRACE_MS + 10_000).then(() => null)]);
  ok("el segundo apagado también sale con 0", fin2?.code === 0, JSON.stringify(fin2));
  if (!fin2) app2.child.kill("SIGKILL");
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await sql`delete from wa_send_lease where organization_id = ${ORG}`.catch(() => {});
  await sql`delete from organization where id = ${ORG}`.catch((e) => console.error("no se pudo borrar la organización de prueba:", e.message));
  await sql.end();
}
console.log(`\n${checks - failures}/${checks} comprobaciones OK`);
process.exit(failures === 0 ? 0 : 1);
