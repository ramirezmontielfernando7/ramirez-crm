/**
 * Self-test E2E de 042 — Interruptores de los agentes de IA
 * (specs/042-pausa-agentes/spec.md). Contra la app real con mocks.
 *
 *  1. Línea base: con el agente encendido, un mensaje real recibe respuesta.
 *  2. Interruptor GENERAL (API): en pausa, un mensaje real NO recibe respuesta
 *     del agente, el chat pasa a atención humana (handoff 'pausa', aviso en la
 *     línea de tiempo) y conserva etapa, asignación y no leídos.
 *  3. Pantalla (navegador real): el Estudio de IA muestra el aviso rojo
 *     mientras dura la pausa; «Reanudar agentes» lo quita.
 *  4. Interruptor POR AGENTE: apagar al general lo marca «Apagado» en la lista
 *     y sus chats pasan a una persona; encenderlo lo devuelve.
 *  5. Tras reanudar, un chat nuevo vuelve a recibir respuesta.
 *
 * Uso: app viva con WA_MOCK_ENABLED=true y los mocks (ai-mock, wa-mock):
 *   node --env-file=.env scripts/e2e-pausa-agentes.mjs
 * Re-ejecutable (deja el agente como lo encontró). Sale con 1 si algo falla.
 */
import postgres from "postgres";
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const ADMIN = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
const PN = `PN-E2E-PAUSA-${RUN}`;

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
async function hasta(cond, ms = 30000) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(500);
  }
}

const sql = postgres(process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL, { max: 2, onnotice: () => {} });

let cookie = "";
async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      "x-forwarded-for": `10.42.${Number(RUN.slice(-3)) % 256}.9`,
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // no es JSON
  }
  return { status: res.status, json, text };
}
const post = (path, body) => api(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const put = (path, body) => api(path, { method: "PUT", body: JSON.stringify(body) });

async function main() {
  console.log("== Setup ==");
  let login = await post("/api/auth/sign-in/email", { email: ADMIN.email, password: ADMIN.password });
  if (login.status >= 400) {
    await post("/api/auth/sign-up/email", ADMIN);
    login = await post("/api/auth/sign-in/email", { email: ADMIN.email, password: ADMIN.password });
  }
  ok("el Propietario entra", login.status < 400, String(login.status));
  const [{ organization_id: org } = {}] = await sql`
    select m.organization_id from member m join "user" u on u.id = m.user_id where u.email = ${ADMIN.email}`;
  ok("su organización existe", Boolean(org));

  const [cred] = await sql`select phone_number_id from meta_credentials where organization_id = ${org} limit 1`;
  let pn = cred?.phone_number_id;
  if (!pn) {
    const conn = await put("/api/settings/whatsapp", { wabaId: `WABA-E2E-PAUSA-${RUN}`, phoneNumberId: PN, token: "tok-e2e-pausa" });
    ok("conectar WhatsApp de prueba", conn.status < 400, conn.text.slice(0, 200));
    pn = PN;
  }
  const perfil = (await api("/api/agent/profile")).json?.profile;
  const encendidoAntes = Boolean(perfil?.enabled);
  await put("/api/agent/profile", { enabled: true });
  await put("/api/agent/pause", { paused: false });
  const general = ((await api("/api/lab/agents")).json?.agents ?? []).find((a) => a.isGeneral);
  ok("hay agente general", Boolean(general?.id));
  await put(`/api/lab/agents/${general?.id}/pause`, { paused: false });

  let n = 0;
  /** Un cliente nuevo escribe; devuelve su tel, la respuesta del agente (si hubo) y su fila. */
  const escribe = async (esperaRespuesta) => {
    n++;
    const tel = `52155${RUN}${String(n).padStart(2, "0")}`;
    await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
    await post("/api/dev/wa-mock/inbound", { phoneNumberId: pn, from: tel, name: `Cliente Pausa ${RUN}-${n}`, text: "hola, ¿quién eres?", waMessageId: `wamid.pausa.${RUN}.${n}` });
    let respuesta = null;
    await hasta(async () => {
      respuesta = ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).find((o) => o.to === tel) ?? null;
      return respuesta;
    }, esperaRespuesta ? 45000 : 8000);
    // El turno corre en segundo plano: da tiempo a que traspase.
    if (!esperaRespuesta) await hasta(async () => {
      const [f] = await sql`
        select cv.handoff_reason from contact c join conversation cv on cv.contact_id = c.id and not cv.is_test
        where c.organization_id = ${org} and c.wa_identity = ${tel}`;
      return f?.handoff_reason;
    }, 20000);
    const [fila] = await sql`
      select cv.id as conversation_id, cv.handoff_at, cv.handoff_reason, cv.unread_count, cv.ai_enabled, c.id as contact_id,
             c.assigned_user_id, l.stage_id
      from contact c join conversation cv on cv.contact_id = c.id and not cv.is_test
      left join lead l on l.contact_id = c.id
      where c.organization_id = ${org} and c.wa_identity = ${tel}`;
    return { tel, respuesta, fila };
  };

  console.log("\n== 1. Línea base: el agente responde ==");
  const base = await escribe(true);
  ok("con el agente encendido, un mensaje real recibe respuesta", Boolean(base.respuesta), JSON.stringify(base.fila));
  ok("…y el chat sigue con la IA (sin traspaso)", base.fila?.handoff_at === null);

  console.log("\n== 2. Interruptor general: en pausa pasa a una persona ==");
  const pausa = await put("/api/agent/pause", { paused: true });
  ok("pausar → 200 y paused:true", pausa.status === 200 && pausa.json?.paused === true, pausa.text.slice(0, 200));
  const enPausa = await escribe(false);
  ok("en pausa NO responde el agente", enPausa.respuesta === null, JSON.stringify(enPausa.respuesta));
  ok("el chat pasa a atención humana (handoff 'pausa'), no se queda en silencio", enPausa.fila?.handoff_reason === "pausa" && enPausa.fila?.handoff_at !== null, JSON.stringify(enPausa.fila));
  ok("conserva su etapa y sus no leídos", Boolean(enPausa.fila?.stage_id) && enPausa.fila?.unread_count >= 1, JSON.stringify(enPausa.fila));
  ok("la IA del chat sigue habilitada (reanudar no exige tocarlo)", enPausa.fila?.ai_enabled === true);
  const linea = (await api(`/api/contacts/${enPausa.fila?.contact_id}/timeline`)).json?.items ?? [];
  ok("la línea de tiempo lo registra como traspaso", linea.some((i) => i.kind === "ai_handoff" && i.detail?.reason === "pausa"), JSON.stringify(linea).slice(0, 300));
  const config = await api("/api/agent/profile");
  ok("pausar no tocó la configuración del agente", config.json?.profile?.instructions === perfil?.instructions && config.json?.profile?.name === perfil?.name);

  console.log("\n== 3. Pantalla: aviso mientras esté en pausa ==");
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`${BASE}/login`);
    await page.fill("input[type=email]", ADMIN.email);
    await page.fill("input[type=password]", ADMIN.password);
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));

    await page.goto(`${BASE}/lab`);
    const aviso = page.getByTestId("agents-paused-banner");
    await aviso.waitFor();
    ok("el Estudio de IA muestra el aviso de pausa", /en pausa/i.test(await aviso.innerText()));
    const fila = page.locator("ul > li").first();
    ok("los interruptores por agente quedan bloqueados mientras dura la pausa general", await fila.getByRole("switch").isDisabled());
    await page.getByTestId("agents-resume").click();
    await aviso.waitFor({ state: "detached" });
    ok("«Reanudar agentes» quita el aviso", (await aviso.count()) === 0);
    ok("…y el servidor ya no está en pausa", (await api("/api/agent/pause")).json?.paused === false);

    console.log("\n== 4. Interruptor por agente ==");
    const sw = page.locator("ul > li").first().getByRole("switch");
    ok("el general aparece Activo", (await sw.getAttribute("aria-checked")) === "true");
    await sw.click();
    await page.locator("ul > li").first().getByText("Apagado").first().waitFor();
    ok("apagarlo desde la lista lo marca «Apagado»", ((await api("/api/lab/agents")).json?.agents ?? []).find((a) => a.isGeneral)?.paused === true);
    const apagado = await escribe(false);
    ok("con el agente apagado, su chat pasa a una persona (sin respuesta del agente)", apagado.respuesta === null && apagado.fila?.handoff_reason === "pausa", JSON.stringify(apagado.fila));
    await sw.click();
    await page.waitForFunction(() => document.querySelector("ul > li [role=switch]")?.getAttribute("aria-checked") === "true");
    ok("encenderlo lo devuelve a Activo", ((await api("/api/lab/agents")).json?.agents ?? []).find((a) => a.isGeneral)?.paused === false);
  } finally {
    await browser.close();
  }

  console.log("\n== 5. Reanudado: vuelve a responder ==");
  const despues = await escribe(true);
  ok("tras reanudar, un chat nuevo recibe respuesta", Boolean(despues.respuesta), JSON.stringify(despues.fila));

  await put("/api/agent/pause", { paused: false });
  await put(`/api/lab/agents/${general?.id}/pause`, { paused: false });
  await put("/api/agent/profile", { enabled: encendidoAntes });
}

try {
  await main();
} catch (err) {
  failures++;
  console.error("ERROR", err);
} finally {
  await sql.end();
}
console.log(`\n${checks - failures}/${checks} verificaciones OK`);
if (failures > 0) {
  console.log("Fallaron:\n - " + fallas.join("\n - "));
  process.exit(1);
}
