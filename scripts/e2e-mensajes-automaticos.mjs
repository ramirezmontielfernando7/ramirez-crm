/**
 * Self-test E2E de la spec 049 — Mensajes automáticos sin IA, chats olvidados,
 * tiempo de primera respuesta y «Exportar todos mis datos». Contra la app real
 * con mocks (WA_MOCK_ENABLED, wa-mock):
 *
 *  1. Ajustes: apagado de fábrica; validaciones (texto vacío, sin días abiertos).
 *  2. Bienvenida: un chat nuevo recibe «Hola {nombre}…» UNA sola vez, marcada
 *     como automática; un segundo mensaje no la repite.
 *  3. Fuera de horario: cerrado, sale SOLO el aviso (no la bienvenida) y no se
 *     repite en 12 h; abierto, no sale.
 *  4. Chats olvidados: el aviso llega por SSE (motivo «olvidado») al Propietario;
 *     un mensaje automático NO saca al chat de la lista «Esperando respuesta»;
 *     una respuesta de una persona sí.
 *  5. Primera respuesta del equipo (Resultados → Atención).
 *  6. Exportar todos mis datos: ZIP con CSV (contactos, embudo, conversaciones,
 *     mensajes con «quien»); sin sesión, 401.
 *  7. En el navegador: pantallas de Ajustes, burbuja marcada, Resultados.
 *
 * Capturas opcionales: E2E_CAPTURAS=<carpeta> (2x).
 * Uso: `node --env-file=.env scripts/e2e-mensajes-automaticos.mjs` con la app
 * viva y los mocks. Re-ejecutable. Sale con 1 si algo falla.
 */
import { mkdirSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const CAPTURAS = process.env.E2E_CAPTURAS || "";
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });

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
async function hasta(cond, ms = 20000, paso = 300) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await Promise.resolve(cond()).catch(() => false)) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}
const num = (p, s) => `52${p}${RUN.slice(-4)}${s}`;

let cookie = "";
async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      "x-forwarded-for": `10.49.${Number(RUN.slice(-3)) % 256}.9`,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  let text = null;
  try {
    text = await res.clone().text();
    json = JSON.parse(text);
  } catch {}
  return { res, json, text };
}
const post = (p, b) => api(p, { method: "POST", body: JSON.stringify(b) });
const put = (p, b) => api(p, { method: "PUT", body: JSON.stringify(b) });

const PN = "PN-E2E";
const inbound = (from, name, text, n) =>
  post("/api/dev/wa-mock/inbound", { phoneNumberId: PN, from, name, text, waMessageId: `wamid.e2e.auto.${RUN}.${n}` });
const outbox = async () => (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
const textsTo = async (phone) =>
  (await outbox()).filter((o) => String(o.to ?? o.payload?.to ?? "").includes(phone)).map((o) => o.body?.text?.body ?? "");

const ALWAYS_OPEN = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: true, from: "00:00", to: "23:59" }]));
// «Cerrado» casi siempre: una ventana de un minuto a las 03:00 UTC.
const MOSTLY_CLOSED = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: true, from: "03:00", to: "03:01" }]));
const settings = (patch) => ({
  welcomeEnabled: false, welcomeText: null, awayEnabled: false, awayText: null,
  hours: ALWAYS_OPEN, timezone: "UTC", forgottenAlertHours: null, ...patch,
});

const sql = postgres(process.env.DATABASE_URL_MIGRATE, { max: 1 });

async function main() {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`La app no responde en ${BASE}`);
    process.exit(1);
  }

  console.log("== Setup ==");
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await post("/api/auth/sign-in/email", { email, password });
  if (!su.res.ok) su = await post("/api/auth/sign-up/email", { email, password, name: "Operador E2E" });
  ok("login del propietario", su.res.ok, su.text);
  const conn = await put("/api/settings/whatsapp", { wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" });
  ok("WhatsApp conectado (wa-mock)", conn.res.ok, conn.text);
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });

  console.log("\n== 1. Ajustes ==");
  const g0 = await api("/api/settings/auto-replies");
  ok("GET responde y todo viene apagado de fábrica", g0.res.ok && g0.json?.defaults?.welcomeEnabled === false && g0.json?.defaults?.forgottenAlertHours === null, g0.text);
  const bad1 = await put("/api/settings/auto-replies", settings({ welcomeEnabled: true, welcomeText: "  " }));
  ok("bienvenida encendida sin texto → 422", bad1.res.status === 422, bad1.text);
  const closedAll = Object.fromEntries(Object.keys(ALWAYS_OPEN).map((d) => [d, { open: false, from: "09:00", to: "18:00" }]));
  const bad2 = await put("/api/settings/auto-replies", settings({ awayEnabled: true, awayText: "x", hours: closedAll }));
  ok("fuera de horario sin ningún día abierto → 422", bad2.res.status === 422, bad2.text);
  const bad3 = await put("/api/settings/auto-replies", settings({ timezone: "Marte/Olimpo" }));
  ok("zona horaria inexistente → 422", bad3.res.status === 422, bad3.text);
  const bad4 = await put("/api/settings/auto-replies", settings({ forgottenAlertHours: 3 }));
  ok("horas de aviso fuera de la lista → 422", bad4.res.status === 422, bad4.text);

  console.log("\n== 2. Bienvenida (abierto, solo la bienvenida) ==");
  const save1 = await put("/api/settings/auto-replies", settings({ welcomeEnabled: true, welcomeText: "Hola {nombre}, gracias por escribirnos." }));
  ok("ajustes guardados", save1.res.ok, save1.text);
  const ana = num(51, "30001");
  await inbound(ana, "Ana López", "Hola, quiero informes", 1);
  ok("el chat nuevo recibe la bienvenida con su nombre", await hasta(async () => (await textsTo(ana)).includes("Hola Ana, gracias por escribirnos.")), JSON.stringify(await textsTo(ana)));
  await inbound(ana, "Ana López", "¿Y los precios?", 2);
  await sleep(2500);
  ok("un segundo mensaje NO repite la bienvenida", (await textsTo(ana)).length === 1, JSON.stringify(await textsTo(ana)));
  const convs = (await api("/api/conversations")).json?.conversations ?? [];
  const anaConv = convs.find((c) => c.contact.phone === ana);
  const msgs = (await api(`/api/conversations/${anaConv?.id}/messages`)).json?.messages ?? [];
  ok("el mensaje está marcado como automático (bienvenida)", msgs.some((m) => m.direction === "out" && m.autoKind === "welcome"), JSON.stringify(msgs.map((m) => [m.direction, m.autoKind])));

  console.log("\n== 3. Fuera de horario (cerrado: solo el aviso, una vez) ==");
  const save2 = await put("/api/settings/auto-replies", settings({
    welcomeEnabled: true, welcomeText: "Hola {nombre}, bienvenido.",
    awayEnabled: true, awayText: "Estamos fuera de horario, te respondemos mañana.",
    hours: MOSTLY_CLOSED,
  }));
  ok("ajustes con horario cerrado guardados", save2.res.ok, save2.text);
  const beto = num(52, "30002");
  await inbound(beto, "Beto Ruiz", "¿Abren hoy?", 3);
  ok("sale el aviso de fuera de horario", await hasta(async () => (await textsTo(beto)).includes("Estamos fuera de horario, te respondemos mañana.")), JSON.stringify(await textsTo(beto)));
  await sleep(1500);
  ok("…y NO la bienvenida encima (un solo mensaje)", (await textsTo(beto)).length === 1, JSON.stringify(await textsTo(beto)));
  await inbound(beto, "Beto Ruiz", "¿Hola?", 4);
  await sleep(2500);
  ok("no se repite el aviso dentro de 12 h", (await textsTo(beto)).length === 1, JSON.stringify(await textsTo(beto)));
  // Abierto: no hay aviso.
  await put("/api/settings/auto-replies", settings({ awayEnabled: true, awayText: "Estamos fuera de horario.", hours: ALWAYS_OPEN }));
  const carla = num(53, "30003");
  await inbound(carla, "Carla Soto", "Hola", 5);
  await sleep(3000);
  ok("con el negocio abierto no sale ningún aviso", (await textsTo(carla)).length === 0, JSON.stringify(await textsTo(carla)));

  console.log("\n== 4. Chats olvidados ==");
  await put("/api/settings/auto-replies", settings({ welcomeEnabled: true, welcomeText: "Bienvenida automática.", forgottenAlertHours: 1 }));
  const dani = num(54, "30004");
  await inbound(dani, "Dani Mora", "Necesito ayuda", 6);
  ok("Dani recibió solo la bienvenida automática", await hasta(async () => (await textsTo(dani)).length === 1));
  // El cliente lleva 2 h esperando (la bienvenida automática no cuenta como respuesta).
  const [org] = await sql`select organization_id from contact where phone = ${dani} limit 1`;
  await sql`update conversation set last_inbound_at = now() - interval '2 hours' where contact_id = (select id from contact where phone = ${dani} limit 1)`;
  const hy1 = (await api("/api/analytics/hygiene")).json;
  ok("el chat aparece en «Esperando respuesta» (el automático no cuenta)", (hy1?.waiting ?? []).some((w) => w.name === "Dani Mora"), JSON.stringify(hy1?.waiting));
  // El aviso en vivo: el barrido corre cada 5 min (la primera, al minuto de arrancar).
  const events = [];
  const ctrl = new AbortController();
  void (async () => {
    const res = await fetch(`${BASE}/api/events`, { headers: { cookie }, signal: ctrl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const type = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (type) events.push({ type, data: data ? JSON.parse(data) : null });
      }
    }
  })().catch(() => {});
  ok("llega el aviso «olvidado» por SSE al Propietario (puede tardar hasta 5 min)", await hasta(() => events.some((e) => e.type === "handoff.requested" && e.data?.reason === "olvidado" && e.data?.contactName === "Dani Mora"), 330000, 2000), JSON.stringify(events.slice(-3)));
  ctrl.abort();
  const [stamp] = await sql`select forgotten_alerted_at from conversation where contact_id = (select id from contact where phone = ${dani} limit 1)`;
  ok("queda anotado para no repetirlo", !!stamp?.forgotten_alerted_at);
  // Una persona contesta → sale de la lista.
  const daniConv = ((await api("/api/conversations")).json?.conversations ?? []).find((c) => c.contact.phone === dani);
  const rep = await post(`/api/conversations/${daniConv?.id}/messages`, { text: "Hola Dani, ya te atiendo" });
  ok("una persona contesta", rep.res.ok, rep.text);
  const hy2 = (await api("/api/analytics/hygiene")).json;
  ok("…y sale de «Esperando respuesta»", !(hy2?.waiting ?? []).some((w) => w.name === "Dani Mora"), JSON.stringify(hy2?.waiting));

  console.log("\n== 5. Primera respuesta del equipo ==");
  const day = (d) => d.toISOString().slice(0, 10);
  const from = day(new Date(Date.now() - 7 * 86400000));
  const to = day(new Date(Date.now() + 86400000));
  const bot = await api(`/api/analytics/bot?from=${from}&to=${to}`);
  ok("el bloque trae «team»", bot.res.ok && bot.json?.team && typeof bot.json.team.chats === "number", bot.text);
  ok("hay al menos una respuesta de una persona con mediana", bot.json?.team?.answeredByPerson >= 1 && bot.json?.team?.medianSeconds !== null, JSON.stringify(bot.json?.team));
  ok("hay chats sin ninguna respuesta (Ana/Beto/Carla solo con automático o nada)", bot.json?.team?.unanswered >= 1, JSON.stringify(bot.json?.team));

  console.log("\n== 6. Exportar todos mis datos ==");
  const noSession = await fetch(`${BASE}/api/data-export`, { redirect: "manual" });
  ok("sin sesión → 401", noSession.status === 401, String(noSession.status));
  const exp = await fetch(`${BASE}/api/data-export`, { headers: { cookie } });
  ok("con sesión del Propietario → 200 ZIP", exp.status === 200 && (exp.headers.get("content-type") ?? "").includes("zip"), `${exp.status} ${exp.headers.get("content-type")}`);
  const bytes = new Uint8Array(await exp.arrayBuffer());
  const files = unzipSync(bytes);
  const names = Object.keys(files).sort();
  ok("trae los cinco archivos", ["LEEME.txt", "contactos.csv", "conversaciones.csv", "embudo.csv", "mensajes.csv"].every((n) => names.includes(n)), names.join(","));
  const contactos = strFromU8(files["contactos.csv"] ?? new Uint8Array());
  const mensajes = strFromU8(files["mensajes.csv"] ?? new Uint8Array());
  const bom = files["contactos.csv"]?.slice(0, 3).join(",") === "239,187,191";
  ok("contactos.csv incluye a Ana López y empieza con BOM + cabecera", bom && contactos.replace(/^\uFEFF/, "").startsWith("nombre,telefono") && contactos.includes("Ana López"), contactos.slice(0, 200));
  ok("mensajes.csv separa cliente / equipo / automático", mensajes.includes(",cliente,") && mensajes.includes(",equipo,") && mensajes.includes(",automático,"), mensajes.slice(0, 400));
  ok("el texto de un mensaje del cliente está completo", mensajes.includes("Necesito ayuda"));
  const embudo = strFromU8(files["embudo.csv"] ?? new Uint8Array());
  ok("embudo.csv trae sus oportunidades (cabecera + filas)", embudo.split("\r\n").length > 2, embudo.slice(0, 200));
  void org;

  console.log("\n== 7. Navegador ==");
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-MX", deviceScaleFactor: CAPTURAS ? 2 : 1 });
    await ctx.addCookies(cookie.split("; ").map((c) => {
      const i = c.indexOf("=");
      return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE };
    }));
    // Carla lleva 2 h esperando: la lista «Esperando respuesta» tiene a quién mostrar.
    await sql`update conversation set last_inbound_at = now() - interval '2 hours' where contact_id = (select id from contact where phone = ${carla} limit 1)`;
    const page = await ctx.newPage();
    const shot = async (name) => {
      if (CAPTURAS) await page.screenshot({ path: `${CAPTURAS}/${name}.png` }).catch(() => {});
    };
    await page.goto(`${BASE}/settings/auto-mensajes`, { timeout: 120000, waitUntil: "domcontentloaded" });
    ok("Ajustes → Mensajes automáticos carga", await page.getByTestId("auto-replies-settings").waitFor({ state: "visible", timeout: 120000 }).then(() => true).catch(() => false));
    ok("…con el horario y la zona", await page.getByLabel("Lunes: abre").isVisible().catch(() => false));
    await shot("1-ajustes-mensajes-automaticos");
    // Cambiar y guardar desde la pantalla.
    await page.getByLabel("Texto de la bienvenida").fill("Hola {nombre}, ¡qué gusto verte por aquí!");
    await page.getByRole("button", { name: "Guardar" }).click();
    ok("guardar desde la pantalla", await page.getByText("Guardado.").waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false));
    await page.goto(`${BASE}/settings/mis-datos`, { waitUntil: "domcontentloaded" });
    ok("Ajustes → Mis datos tiene el botón de descarga", await page.getByTestId("data-export-link").waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false));
    await shot("2-ajustes-mis-datos");
    // La burbuja marcada en la Bandeja.
    await page.goto(`${BASE}/inbox?contact=${(await sql`select id from contact where phone = ${ana} limit 1`)[0].id}`, { waitUntil: "domcontentloaded" });
    ok("la burbuja automática dice «Bienvenida automática»", await page.getByText("Bienvenida automática").first().waitFor({ state: "visible", timeout: 120000 }).then(() => true).catch(() => false));
    await shot("3-bandeja-burbuja-automatica");
    await page.goto(`${BASE}/results`, { waitUntil: "domcontentloaded" });
    ok("Resultados → «Esperando respuesta» visible", await page.getByTestId("waiting-list").waitFor({ state: "visible", timeout: 120000 }).then(() => true).catch(() => false));
    if (CAPTURAS) await page.locator("#higiene").screenshot({ path: `${CAPTURAS}/4-resultados-esperando.png` }).catch(() => {});
    await page.getByRole("tab", { name: /Atenci/ }).click();
    ok("Resultados → Atención muestra «Atención del equipo»", await page.getByTestId("team-response").waitFor({ state: "visible", timeout: 30000 }).then(() => true).catch(() => false));
    await shot("5-resultados-atencion-equipo");
  } finally {
    await browser.close();
    await sql.end();
  }

  console.log(`\n${checks - failures}/${checks} comprobaciones OK`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
