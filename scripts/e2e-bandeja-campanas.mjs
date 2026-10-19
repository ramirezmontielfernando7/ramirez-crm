/**
 * Self-test E2E de 041 — chats de campaña fuera de la Bandeja principal
 * (tests/e2e/us-bandeja-campanas.md).
 *
 *  1. Un contacto que YA escribía y dos nuevos reciben una campaña real
 *     (cola + wa-mock). Los nuevos van a «Campañas»; el que escribía sigue en
 *     la principal.
 *  2. Durante el envío y los ticks de estado (sent/delivered/read) se escucha
 *     el canal SSE de verdad: ningún evento de los chats pendientes ni de los
 *     ticks; la BD sí guarda cada estado.
 *  3. Uno responde: pasa a la principal con «Respondió a campaña X», con no
 *     leídos y su aviso en vivo.
 *  4. En el navegador: la pestaña «Campañas» de la Bandeja (no Archivados)
 *     muestra al que no respondió; la principal no, y lleva la marca.
 *
 * Uso: app con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock y el
 * módulo Campañas encendido; `node --env-file=.env scripts/e2e-bandeja-campanas.mjs`.
 * Re-ejecutable: cada corrida usa plantilla y teléfonos nuevos. Sale con 1 si algo falla.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);

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
async function hasta(cond, ms = 30000, paso = 300) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await Promise.resolve(cond()).catch(() => false)) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}

/** 13 dígitos únicos por corrida (p entre 20 y 99: nada de «521…»). */
const num = (p, suffix) => `52${p}${RUN.slice(-4)}${suffix}`;

let cookie = "";
async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: {
      ...(isForm ? {} : { "content-type": "application/json" }),
      origin: BASE,
      "x-forwarded-for": `10.41.${Number(RUN.slice(-3)) % 256}.7`,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  let text = null;
  try {
    text = await res.clone().text();
    json = JSON.parse(text);
  } catch {}
  return { res, json, text };
}
const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });

/** Escucha /api/events de verdad (con la sesión) y guarda cada evento. */
function escucharSse() {
  const events = [];
  const ctrl = new AbortController();
  let open = false;
  const done = (async () => {
    const res = await fetch(`${BASE}/api/events`, { headers: { cookie }, signal: ctrl.signal });
    if (!res.ok || !res.body) return;
    open = true;
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
  return { events, isOpen: () => open, stop: () => (ctrl.abort(), done) };
}

const convIdOf = (e) => e.data?.conversationId ?? e.data?.conversation?.id ?? null;

async function main() {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`La app no responde en ${BASE}`);
    process.exit(1);
  }

  console.log("== Setup: login + WhatsApp (wa-mock) + plantilla aprobada ==");
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await post("/api/auth/sign-in/email", { email, password });
  if (!su.res.ok) su = await post("/api/auth/sign-up/email", { email, password, name: "Operador E2E" });
  ok("login del propietario", su.res.ok, su.text);
  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-E2E", phoneNumberId: "PN-E2E", token: "tok-e2e" }),
  });
  ok("WhatsApp conectado", conn.res.ok, conn.text);
  if ((await api("/api/campaigns")).res.status === 404) {
    console.error("El módulo Campañas está apagado para esta organización: enciéndelo (CAMPAIGNS=on o /platform).");
    process.exit(1);
  }
  // Varias corridas mandan marketing a la misma organización: sin tope de frecuencia aquí.
  await api("/api/campaigns/settings", {
    method: "PUT",
    body: JSON.stringify({
      failRatePercent: 20,
      failRateWindow: 50,
      pauseOnQualityRed: true,
      usagePausePercent: 95,
      rates: {},
      currency: null,
      replyWindowHours: 72,
      marketingMinDays: 0,
    }),
  });
  const tplName = `bandeja_${RUN}`;
  const tpl = await post("/api/templates", { name: tplName, language: "es_MX", category: "MARKETING", body: "Hola {{1}}, hay ofertas." });
  ok("plantilla creada", tpl.res.status === 201, tpl.text);
  const tplId = tpl.json?.template?.id;
  await post("/api/dev/wa-mock/template-status", { wabaId: "WABA-E2E", name: tplName, language: "es_MX", event: "APPROVED", notify: false });
  ok("sincronizada y aprobada", (await api("/api/templates/sync", { method: "POST" })).res.ok);

  /* ------------------------------------------------------------ */
  console.log("\n== 1. Un contacto que ya escribía + dos nuevos reciben la campaña ==");
  const activo = num(41, "20001");
  const nuevo1 = num(42, "20002");
  const nuevo2 = num(43, "20003");
  await post("/api/dev/wa-mock/inbound", {
    phoneNumberId: "PN-E2E",
    from: activo,
    name: `Activo ${RUN}`,
    waMessageId: `wamid.e2e.bc.${RUN}.0`,
    text: "Hola, ¿tienen envíos?",
  });
  const conversaciones = async (view) =>
    (await api(`/api/conversations${view ? `?view=${view}` : ""}`)).json ?? { conversations: [] };
  ok("el contacto activo ya tiene su chat en la principal", await hasta(async () => (await conversaciones()).conversations.some((c) => c.contact.phone === activo)));

  const csv = ["nombre,numero", `Activo ${RUN},${activo}`, `Nuevo1 ${RUN},${nuevo1}`, `Nuevo2 ${RUN},${nuevo2}`].join("\n");
  const form = new FormData();
  form.set("file", new Blob([csv]), `bandeja-${RUN}.csv`);
  form.set("consentAnswer", "yes");
  form.set("name", `Bandeja ${RUN}`);
  const imp = await api("/api/campaigns/audiences", { method: "POST", body: form });
  ok("base importada (3)", imp.res.status === 201 && imp.json?.audience?.counts?.members === 3, imp.text);

  const campName = `Ofertas ${RUN}`;
  const draft = await post("/api/campaigns", {
    name: campName,
    templateId: tplId,
    variables: [{ kind: "contact_name" }],
    audience: { importId: imp.json?.audience?.id },
  });
  ok("borrador creado", draft.res.status === 201, draft.text);
  const campId = draft.json?.campaign?.id;

  // El canal en vivo, abierto ANTES de enviar: lo que la Bandeja recibiría.
  const sse = escucharSse();
  ok("canal SSE abierto", await hasta(() => sse.isOpen(), 10000));
  const antes = await conversaciones();
  const activoConv = antes.conversations.find((c) => c.contact.phone === activo);

  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  const send = await api(`/api/campaigns/${campId}/send`, { method: "POST" });
  ok("enviar → 202", send.res.status === 202, send.text);
  let camp;
  ok(
    "la campaña terminó",
    await hasta(async () => (camp = (await api(`/api/campaigns/${campId}`)).json?.campaign)?.status === "completed", 60000),
    JSON.stringify(camp)
  );
  ok("3 enviados", camp?.counts?.sent === 3, JSON.stringify(camp?.counts));

  const main1 = await conversaciones();
  const camp1 = await conversaciones("campaigns");
  const phonesMain = main1.conversations.map((c) => c.contact.phone);
  const pend = camp1.conversations.filter((c) => [nuevo1, nuevo2].includes(c.contact.phone));
  ok("los nuevos NO están en la Bandeja principal", !phonesMain.includes(nuevo1) && !phonesMain.includes(nuevo2), JSON.stringify(phonesMain));
  ok("…están en «Campañas», con su campaña", pend.length === 2 && pend.every((c) => c.campaign?.state === "pending" && c.campaign?.name === campName), JSON.stringify(pend.map((c) => c.campaign)));
  ok("…y no cuentan como no leídos", pend.every((c) => c.unreadCount === 0));
  ok("la principal trae el contador de «Campañas»", (main1.campaignPending ?? 0) >= 2, String(main1.campaignPending));
  ok("el contacto que ya escribía sigue en la principal", phonesMain.includes(activo));
  ok("…sin marca de pendiente", main1.conversations.find((c) => c.contact.phone === activo)?.campaign === null);
  const pendIds = new Set(pend.map((c) => c.id));

  /* ------------------------------------------------------------ */
  console.log("\n== 2. Ticks de estado del envío masivo: BD sí, SSE no ==");
  const out = ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).filter((m) => m.body?.template?.name === tplName);
  ok("Meta (mock) recibió 3 plantillas", out.length === 3, String(out.length));
  const t0 = Math.floor(Date.now() / 1000);
  for (const [i, status] of ["sent", "delivered", "read"].entries()) {
    for (const m of out) await post("/api/dev/wa-mock/status", { waMessageId: m.waMessageId, status, timestamp: t0 + i });
  }
  // Dejar llegar lo que el canal fuera a mandar (y un heartbeat no cuenta).
  await sleep(2500);
  const evs = sse.events;
  const deTicks = evs.filter((e) => e.type === "message.status");
  const dePendientes = evs.filter((e) => ["message.new", "conversation.updated", "message.status"].includes(e.type) && pendIds.has(convIdOf(e)));
  ok("ningún message.status por los 9 ticks", deTicks.length === 0, JSON.stringify(deTicks));
  ok("ningún evento de los chats pendientes", dePendientes.length === 0, JSON.stringify(dePendientes));
  const delActivo = evs.filter((e) => e.type === "message.new" && convIdOf(e) === activoConv?.id);
  ok("el chat activo sí avisó su envío (1 message.new)", delActivo.length === 1, JSON.stringify(evs.map((e) => e.type)));
  const msgs = (await api(`/api/conversations/${pend[0]?.id}/messages`)).json?.messages ?? [];
  ok("la BD guardó el último estado (leído)", msgs.some((m) => m.direction === "out" && m.status === "read"), JSON.stringify(msgs.map((m) => m.status)));

  /* ------------------------------------------------------------ */
  console.log("\n== 3. Responde: pasa a la principal con «Respondió a campaña X» ==");
  const corte = sse.events.length;
  const r1 = pend.find((c) => c.contact.phone === nuevo1);
  await post("/api/dev/wa-mock/inbound", {
    phoneNumberId: "PN-E2E",
    from: nuevo1,
    name: `Nuevo1 ${RUN}`,
    waMessageId: `wamid.e2e.bc.${RUN}.1`,
    text: "Me interesa",
  });
  let fila;
  ok(
    "aparece en la principal",
    await hasta(async () => (fila = (await conversaciones()).conversations.find((c) => c.contact.phone === nuevo1)) != null)
  );
  ok("…con «Respondió a campaña»", fila?.campaign?.state === "replied" && fila?.campaign?.name === campName, JSON.stringify(fila?.campaign));
  ok("…y cuenta como no leído", fila?.unreadCount === 1, String(fila?.unreadCount));
  ok("ya no está en «Campañas»", !(await conversaciones("campaigns")).conversations.some((c) => c.contact.phone === nuevo1));
  ok(
    "su respuesta sí avisó en vivo (message.new)",
    await hasta(() => sse.events.slice(corte).some((e) => e.type === "message.new" && convIdOf(e) === r1?.id), 5000),
    JSON.stringify(sse.events.slice(corte).map((e) => e.type))
  );
  await sse.stop();

  /* ------------------------------------------------------------ */
  console.log("\n== 4. En el navegador: pestaña «Campañas» de la Bandeja ==");
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-MX" });
    await ctx.addCookies(
      cookie.split("; ").map((c) => {
        const i = c.indexOf("=");
        return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE };
      })
    );
    mkdirSync("scratch", { recursive: true });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/inbox`, { timeout: 180000, waitUntil: "domcontentloaded" });
    const row = (text) => page.locator("[data-conversation-row]", { hasText: text });
    ok("la Bandeja carga con quien respondió", await row(`Nuevo1 ${RUN}`).first().isVisible({ timeout: 120000 }).catch(() => false) || (await hasta(() => row(`Nuevo1 ${RUN}`).first().isVisible(), 60000)));
    await page.waitForLoadState("networkidle").catch(() => {});
    ok("…con la marca «Respondió a campaña»", await hasta(() => row(`Nuevo1 ${RUN}`).getByText(`Respondió a campaña ${campName}`).isVisible(), 15000));
    ok("el que no respondió no está en la principal", (await row(`Nuevo2 ${RUN}`).count()) === 0);
    await page.getByRole("button", { name: /^Filtrar la bandeja/ }).click();
    const tab = page.getByRole("button", { name: /^Campañas/ });
    ok("«Campañas» está en los filtros de la Bandeja", await hasta(() => tab.isVisible(), 10000));
    const archivados = page.getByRole("button", { name: /^Archivados/ });
    ok("…aparte de «Archivados»", await archivados.isVisible());
    await tab.click();
    ok("la pestaña muestra al que no respondió", await hasta(() => row(`Nuevo2 ${RUN}`).isVisible(), 15000));
    ok("…con «sin respuesta»", await hasta(() => row(`Nuevo2 ${RUN}`).getByText(`Campaña ${campName} · sin respuesta`).isVisible(), 5000));
    ok("…y no muestra al que respondió", (await row(`Nuevo1 ${RUN}`).count()) === 0);
    // `scratch/` está en .gitignore (capturas de los self-tests).
    await page.screenshot({ path: `scratch/e2e-bandeja-campanas-${RUN}.png` }).catch(() => {});
  } finally {
    await browser.close();
  }

  console.log(`\n${checks - failures}/${checks} comprobaciones OK`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
