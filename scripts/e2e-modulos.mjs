/**
 * Self-test E2E de la Fase 3, PR 3 — módulos por organización
 * (tests/e2e/us-modulos.md). Contra la app real con mocks:
 *
 *  1. Una organización nueva (B) nace con los módulos del entorno: los mismos
 *     que A.
 *  2. El administrador de plataforma apaga en B Campañas, Agenda,
 *     Atribución, Instagram y Messenger. Una usuaria común no puede (404).
 *  3. Con la sesión de B, sus rutas y pantallas responden 404 EN EL SERVIDOR
 *     y su menú no las muestra; A, con todo encendido, sigue igual.
 *  4. Los webhooks de B: el anuncio entra sin `ctwa_clid` (Atribución
 *     apagada) y un mensaje de Messenger se ignora (el canal está apagado
 *     para B aunque A lo tenga). Al encender Messenger, el siguiente entra.
 *  5. Desde /platform (navegador) se vuelve a encender Campañas para B, y la
 *     bitácora lo registra.
 *
 * Uso: app viva con WA_MOCK_ENABLED=true, los mocks y PLATFORM_ORG_ID = la
 * organización de e2e@vocero.test (corre antes pnpm test:e2e). Las variables
 * CAMPAIGNS, AGENDA… pueden valer lo que sea: el guion compara la fila de B
 * con ellas y después enciende o apaga a mano.
 *   node --env-file=.env scripts/e2e-modulos.mjs
 * Re-ejecutable (cada corrida crea su propia organización B). Sale con 1 si
 * algo falla.
 */
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const ADMIN = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
const OWNER_B = { email: `duena.mod.${RUN}@modulos.test`, name: `Dueña Módulos ${RUN}` };
const PASS_B = "contraseña-de-la-duena-mod";
const NAME_B = `Negocio Módulos ${RUN}`;
const PN_A = "PN-E2E-MOD-A";
const PN_B = `PN-E2E-MOD-B-${RUN}`;
const PAGE_B = `page-mod-b-${RUN}`;
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN;
const APP_SECRET = process.env.META_APP_SECRET ?? "";

let failures = 0;
let checks = 0;
const fallas = [];
function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    fallas.push(name);
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 15000) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(400);
  }
}

const sql = postgres(process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL, { max: 2, onnotice: () => {} });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});

let ips = 0;
/** Una persona: su propio navegador (cookies) y su propia IP (límite de login). */
async function persona() {
  ips++;
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.89.${Number(RUN.slice(-3)) % 256}.${ips}`, origin: BASE } });
  const call = async (method, path, body) => {
    const res = await ctx.request.fetch(`${BASE}${path}`, { method, data: body, failOnStatusCode: false, maxRedirects: 0, timeout: 180000 });
    let json = null;
    try {
      json = await res.json();
    } catch {
      // no es JSON
    }
    return { status: res.status(), json };
  };
  const entrar = async (email, password) => await call("POST", "/api/auth/sign-in/email", { email, password });
  const pagina = async (path) => {
    const p = await ctx.newPage();
    const r = await p.goto(`${BASE}${path}`, { timeout: 180000 });
    return { p, status: r?.status() ?? 0 };
  };
  return { ctx, call, entrar, pagina };
}

/** Evento de Messenger por Meta, firmado con el App Secret como lo firma Meta. */
async function messengerMeta(pageId, psid, mid, text) {
  const body = JSON.stringify({
    object: "page",
    entry: [{ id: pageId, time: Date.now(), messaging: [{ sender: { id: psid }, recipient: { id: pageId }, timestamp: Date.now(), message: { mid, text } }] }],
  });
  const firma = `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
  const res = await fetch(`${BASE}/api/webhooks/messenger/${VERIFY_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": firma },
    body,
  });
  return res.status;
}

/** Lo que las variables encienden (mismo criterio que src/server/modules/defaults.ts). */
function entorno() {
  const on = (v) => ["on", "1", "true", "si", "sí", "yes"].includes((v ?? "").trim().toLowerCase());
  const channels = (process.env.CHANNELS ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c === "instagram" || c === "messenger");
  return {
    campaigns: on(process.env.CAMPAIGNS),
    agenda: on(process.env.AGENDA),
    atribucion: on(process.env.ATRIBUCION),
    channels: [...new Set(channels)].sort(),
  };
}

const TODO_ENCENDIDO = { campaigns: true, agenda: true, atribucion: true, instagram: true, messenger: true };
const TODO_APAGADO = { campaigns: false, agenda: false, atribucion: false, instagram: false, messenger: false };

async function main() {
  const A = await persona();
  console.log("== Setup ==");
  let login = await A.entrar(ADMIN.email, ADMIN.password);
  if (login.status >= 400) {
    await A.call("POST", "/api/auth/sign-up/email", ADMIN);
    login = await A.entrar(ADMIN.email, ADMIN.password);
  }
  ok("el operador entra", login.status < 400, String(login.status));
  const [{ organization_id: orgA } = {}] = await sql`
    select m.organization_id from member m join "user" u on u.id = m.user_id where u.email = ${ADMIN.email}`;
  ok("PLATFORM_ORG_ID es la organización del operador (corre con PLATFORM)", process.env.PLATFORM_ORG_ID === orgA, `${process.env.PLATFORM_ORG_ID} vs ${orgA}`);
  const rol = execFileSync("node", ["scripts/platform-admin.mjs", "add", "--email", ADMIN.email, "--apply"], { env: process.env, encoding: "utf8" });
  ok("el operador es administrador de plataforma", /administrador de plataforma/.test(rol), rol);
  await sql`update platform_admin set failed_reauth = 0, locked_until = null where user_id = (select id from "user" where email = ${ADMIN.email})`;
  await A.call("PUT", "/api/settings/whatsapp", { wabaId: "WABA-E2E-MOD-A", phoneNumberId: PN_A, token: "tok-mod-a" });
  const fila = await sql`select organization_id from organization_module where organization_id = ${orgA}`;
  ok("la organización del operador ya tiene su fila de módulos (relleno al arrancar)", fila.length === 1);
  const prendeA = await A.call("POST", `/api/platform/organizations/${orgA}/modules`, TODO_ENCENDIDO);
  ok("A con todos los módulos encendidos", prendeA.status === 200 && Object.entries(TODO_ENCENDIDO).every(([k, v]) => prendeA.json?.modules?.[k] === v), JSON.stringify(prendeA.json));

  const alta = await A.call("POST", "/api/platform/organizations", { name: NAME_B, ownerName: OWNER_B.name, ownerEmail: OWNER_B.email });
  ok("el administrador crea la organización B", alta.status === 201, JSON.stringify(alta.json));
  const orgB = alta.json?.organizationId;
  const token = String(alta.json?.activationUrl ?? "").split("/").pop();
  const activa = await A.call("POST", `/api/account-link/${token}`, { password: PASS_B });
  ok("la Propietaria B activa su cuenta", activa.status === 200, JSON.stringify(activa.json));
  const B = await persona();
  ok("la Propietaria B entra", (await B.entrar(OWNER_B.email, PASS_B)).status < 400);
  ok("B conecta su WhatsApp", (await B.call("PUT", "/api/settings/whatsapp", { wabaId: `WABA-E2E-MOD-B-${RUN}`, phoneNumberId: PN_B, token: "tok-mod-b" })).status === 200);

  console.log("\n== 1 · B nace con los módulos del entorno ==");
  const [modB] = await sql`select campaigns, agenda, atribucion, channels from organization_module where organization_id = ${orgB}`;
  const env = entorno();
  ok(
    "su fila tiene lo de las variables de entorno",
    modB?.campaigns === env.campaigns && modB?.agenda === env.agenda && modB?.atribucion === env.atribucion &&
      [...(modB?.channels ?? [])].sort().join() === env.channels.join(),
    `${JSON.stringify(modB)} vs ${JSON.stringify(env)}`
  );
  ok("B abre Campañas si el entorno las enciende", (await B.call("GET", "/api/campaigns")).status === (env.campaigns ? 200 : 404));
  // A partir de aquí B parte de todo encendido, sea cual sea el entorno.
  await A.call("POST", `/api/platform/organizations/${orgB}/modules`, TODO_ENCENDIDO);
  ok("con todo encendido, B abre sus citas (200)", (await B.call("GET", "/api/bookings")).status === 200);
  const conecta = await B.call("PUT", "/api/settings/messenger", { source: "meta", pageId: PAGE_B, token: "token-pagina-demo" });
  ok("B conecta su página de Messenger", conecta.status === 200, JSON.stringify(conecta.json));
  const listado = (await A.call("GET", "/api/platform/organizations")).json?.organizations ?? [];
  ok("/platform lista los módulos de B", listado.find((o) => o.id === orgB)?.modules?.campaigns === true);

  console.log("\n== 2 · El administrador apaga los módulos de B ==");
  const ajena = await B.call("POST", `/api/platform/organizations/${orgB}/modules`, TODO_ENCENDIDO);
  ok("una usuaria común no puede tocar módulos (404)", ajena.status === 404);
  const apaga = await A.call("POST", `/api/platform/organizations/${orgB}/modules`, TODO_APAGADO);
  ok("el administrador apaga todo en B", apaga.status === 200 && Object.values(apaga.json?.modules ?? {}).filter((v) => v === true).length === 0, JSON.stringify(apaga.json));
  const malo = await A.call("POST", `/api/platform/organizations/${orgB}/modules`, { campaignSendRate: 500 });
  ok("un ritmo fuera de 1–80 → 400/422", malo.status === 400 || malo.status === 422, String(malo.status));
  const nadie = await A.call("POST", `/api/platform/organizations/org_no_existe/modules`, { agenda: true });
  ok("una organización que no existe → 404", nadie.status === 404);
  await sleep(5500); // la caché de módulos dura 5 s por proceso

  console.log("\n== 3 · B: 404 en el servidor; A sigue igual ==");
  const RUTAS = [
    "/api/campaigns",
    "/api/bookings",
    "/api/calendar/settings",
    "/api/calendar/availability",
    "/api/settings/zoom",
    "/api/settings/google",
    "/api/settings/capi",
    "/api/settings/messenger",
    "/api/settings/instagram",
  ];
  for (const ruta of RUTAS) {
    const b = (await B.call("GET", ruta)).status;
    const a = (await A.call("GET", ruta)).status;
    ok(`GET ${ruta}: B → 404, A → ${a}`, b === 404 && a !== 404, `B=${b} A=${a}`);
  }
  const PAGINAS = ["/campaigns", "/campaigns/new", "/bookings", "/settings/calendar", "/settings/ads", "/settings/messenger"];
  for (const ruta of PAGINAS) {
    const b = await B.pagina(ruta);
    const a = await A.pagina(ruta);
    ok(`página ${ruta}: B → 404, A → 200`, b.status === 404 && a.status === 200, `B=${b.status} A=${a.status}`);
    await b.p.close();
    await a.p.close();
  }
  const webB = (await B.call("GET", "/api/settings/webhook")).json;
  ok("B no recibe URLs de Instagram ni Messenger (no es la plataforma)", !webB?.instagramUrl && !webB?.messengerUrl);
  const navB = await B.pagina("/inbox");
  ok("el menú de B no muestra Campañas ni Citas", (await navB.p.getByRole("link", { name: "Campañas" }).count()) === 0 && (await navB.p.getByRole("link", { name: "Citas" }).count()) === 0);
  await navB.p.close();
  const navA = await A.pagina("/inbox");
  ok("el menú de A sí", (await navA.p.getByRole("link", { name: "Campañas" }).count()) > 0 && (await navA.p.getByRole("link", { name: "Citas" }).count()) > 0);
  await navA.p.close();
  const ajustesB = await B.pagina("/settings/whatsapp");
  ok("Ajustes de B no muestra Messenger ni Anuncios", (await ajustesB.p.getByRole("link", { name: "Messenger" }).count()) === 0 && (await ajustesB.p.getByRole("link", { name: /Anuncios/ }).count()) === 0);
  await ajustesB.p.close();

  console.log("\n== 4 · Webhooks de B ==");
  const anuncio = (pn, from, name, clid) =>
    A.call("POST", "/api/dev/wa-mock/inbound", {
      phoneNumberId: pn,
      from,
      name,
      text: `Vengo del anuncio ${RUN}`,
      waMessageId: `wamid.mod.${clid}`,
      referral: { source_id: `1209${RUN}`, source_type: "ad", source_url: "https://fb.me/mod", headline: "Promo módulos", ctwa_clid: clid },
    });
  await anuncio(PN_B, "5215577002201", "Cliente anuncio B", `clid-mod-b-${RUN}`);
  await anuncio(PN_A, "5215577002202", "Cliente anuncio A", `clid-mod-a-${RUN}`);
  const filaAnuncio = async (org) => (await sql`select ctwa_clid, headline from ad_attribution where organization_id = ${org} and source_id = ${`1209${RUN}`}`)[0];
  ok("el anuncio de B se guarda (el origen siempre se ve)", await hasta(async () => Boolean(await filaAnuncio(orgB))));
  ok("…SIN ctwa_clid: la Atribución está apagada para B", (await filaAnuncio(orgB))?.ctwa_clid === null, JSON.stringify(await filaAnuncio(orgB)));
  ok("el de A, CON su ctwa_clid", await hasta(async () => (await filaAnuncio(orgA))?.ctwa_clid === `clid-mod-a-${RUN}`));

  const MARCA_OFF = `messenger apagado ${RUN}`;
  const st = await messengerMeta(PAGE_B, `psid-mod-${RUN}`, `m_mod_off_${RUN}`, MARCA_OFF);
  ok("el webhook de Messenger responde 200 (A lo tiene encendido: la URL existe)", st === 200, String(st));
  await sleep(2500);
  ok("…y el mensaje NO entra a B (canal apagado para B)", (await sql`select 1 from message where organization_id = ${orgB} and text = ${MARCA_OFF}`).length === 0);
  await A.call("POST", `/api/platform/organizations/${orgB}/modules`, { messenger: true });
  await sleep(5500);
  const MARCA_ON = `messenger encendido ${RUN}`;
  await messengerMeta(PAGE_B, `psid-mod-${RUN}`, `m_mod_on_${RUN}`, MARCA_ON);
  ok("con Messenger encendido para B, el siguiente sí entra", await hasta(async () => (await sql`select 1 from message where organization_id = ${orgB} and text = ${MARCA_ON}`).length > 0));

  console.log("\n== 5 · Encender desde /platform ==");
  const page = await A.ctx.newPage();
  await page.goto(`${BASE}/platform`, { timeout: 180000 });
  const filaB = page.getByTestId(`platform-org-${orgB}`);
  await filaB.waitFor({ timeout: 30000 });
  const sw = filaB.getByTestId("platform-module-campaigns").getByRole("switch");
  ok("el interruptor de Campañas de B está apagado", (await sw.getAttribute("aria-checked")) === "false");
  await sw.click();
  ok("al tocarlo queda encendido", await hasta(async () => (await sw.getAttribute("aria-checked")) === "true"));
  await page.close();
  await sleep(5500);
  ok("B vuelve a tener Campañas (200)", (await B.call("GET", "/api/campaigns")).status === 200);
  ok("…y Agenda sigue apagada (404)", (await B.call("GET", "/api/bookings")).status === 404);
  const bitacora = (await A.call("GET", `/api/platform/audit?org=${orgB}`)).json;
  const cambios = (bitacora?.entries ?? []).filter((e) => e.action === "organization.modules_changed");
  ok("la bitácora registra cada cambio de módulos de B", cambios.length >= 3, JSON.stringify(bitacora).slice(0, 300));

  // Deja a B como la encontró el resto de la suite: sin módulos encendidos de más.
  await A.call("POST", `/api/platform/organizations/${orgB}/modules`, TODO_APAGADO);
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await browser.close();
  await sql.end();
}

console.log(`\n${checks - failures}/${checks} checks OK${failures ? `, ${failures} fallos` : ""}`);
if (fallas.length) console.log(`Fallaron:\n - ${fallas.join("\n - ")}`);
process.exit(failures ? 1 : 0);
