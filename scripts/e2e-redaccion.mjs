/**
 * Self-test E2E de 023 — Asistente de redacción en el editor
 * (tests/e2e/us-redaccion.md).
 *
 * Conduce la app REAL con los mocks:
 *   - la varita está junto al clip, deshabilitada con el editor vacío;
 *   - con texto abre el menú (Mejorar, Cambiar tono ▸ Formal/Casual/Empático,
 *     Resumir, Más corto, Más largo);
 *   - al elegir: estado de carga (editor congelado, enviar bloqueado), luego
 *     el texto se REEMPLAZA y aparece "Deshacer", que devuelve el original;
 *   - si la IA falla: error visible y el texto original intacto;
 *   - NO envía nada ni toca la conversación (el hilo no cambia);
 *   - un Asesor también puede usarla (API).
 *
 * Uso: app viva con los mocks (`pnpm dev`), después de `pnpm test:e2e` y
 * `pnpm test:e2e:roles`:
 *   node --env-file=.env scripts/e2e-redaccion.mjs
 * Con SHOTS_DIR=<carpeta> guarda capturas de cada paso.
 * Re-ejecutable. Sale con 1 si algo falla.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR ?? null;
const RUN = Date.now().toString().slice(-7);
const PN = "PN-E2E";
const OWNER = { email: "e2e@vocero.test", password: "password-e2e-123" };
const A = { email: "asesor.a.e2e@vocero.test", password: "password-e2e-roles-123" };

let fails = 0;
let checks = 0;
const ok = (n, c, x = "") => {
  checks++;
  console.log(`  ${c ? "OK  " : "FAIL"} ${n}${!c && x ? " — " + x : ""}`);
  if (!c) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 15000, paso = 300) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}

const browser = await chromium
  .launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" })
  .catch(() => chromium.launch());

async function persona(who) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.click('button[type="submit"]');
  const entro = await page.waitForURL(/inbox/, { timeout: 30000 }).then(() => true, () => false);
  const call = async (method, path, data) => {
    const res = await ctx.request.fetch(`${BASE}${path}`, {
      method,
      data,
      headers: { origin: BASE },
      maxRedirects: 0,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status(), json };
  };
  return { ctx, page, errors, entro, call };
}

const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const owner = await persona(OWNER);
ok("el propietario inicia sesión", owner.entro);

/* ── 1 · API ─────────────────────────────────────────────────────── */
console.log("\n== 1 · API del asistente ==");
const disp = await owner.call("GET", "/api/writing-assist");
ok("GET → available: true (IA configurada)", disp.json?.available === true, JSON.stringify(disp.json));
const mejora = await owner.call("POST", "/api/writing-assist", {
  action: "improve",
  text: "hola si lo tenemos",
});
ok("POST improve → 200 con texto", mejora.status === 200 && typeof mejora.json?.text === "string", `status=${mejora.status}`);
const sinTono = await owner.call("POST", "/api/writing-assist", { action: "tone", text: "hola" });
ok("cambiar tono sin tono → 422", sinTono.status === 422, `status=${sinTono.status}`);
const falla = await owner.call("POST", "/api/writing-assist", { action: "improve", text: "FALLA-IA x" });
ok("modelo sin JSON → 502 con mensaje", falla.status === 502 && Boolean(falla.json?.error?.message), `status=${falla.status}`);

const asesor = await persona(A);
if (asesor.entro) {
  const r = await asesor.call("POST", "/api/writing-assist", { action: "shorten", text: "uno dos tres cuatro cinco seis" });
  ok("un Asesor también la usa → 200", r.status === 200, `status=${r.status}`);
} else {
  ok("el asesor A existe (corre antes pnpm test:e2e:roles)", false);
}
await asesor.ctx.close();

/* ── 2 · Navegador ───────────────────────────────────────────────── */
console.log("\n== 2 · La varita en el editor ==");
await owner.call("PUT", "/api/settings/whatsapp", { wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" });
const nombre = `Redacción ${RUN}`;
await owner.call("POST", "/api/dev/wa-mock/inbound", {
  phoneNumberId: PN,
  from: `5215588${RUN}`,
  name: nombre,
  text: "Hola, ¿tienen disponible el modelo grande?",
  waMessageId: `wamid.e2e.wa.${RUN}`,
});
let conv = null;
await hasta(async () => {
  const r = await owner.call("GET", "/api/conversations");
  conv = r.json?.conversations?.find((c) => c.contact?.name === nombre) ?? null;
  return Boolean(conv);
});
ok("la conversación existe", Boolean(conv));
// Pausar la IA del chat: el agente no debe escribir mientras miramos el hilo.
await owner.call("PATCH", `/api/conversations/${conv?.id}`, { aiEnabled: false });

const page = owner.page;
await page.goto(`${BASE}/inbox`);
await page.getByText(nombre).first().click();
const ta = page.locator("textarea[placeholder^='Escribe una respuesta']");
await ta.waitFor({ timeout: 15000 });
const varita = page.getByRole("button", { name: "Asistente de redacción con IA" });
await varita.waitFor({ timeout: 10000 });

// Junto al clip.
const clip = await page.getByRole("button", { name: "Adjuntar archivo" }).boundingBox();
const vb = await varita.boundingBox();
ok("la varita está justo a la derecha del clip", Boolean(clip && vb && vb.x > clip.x && vb.x - clip.x < 50 && Math.abs(vb.y - clip.y) < 4));
ok("con el editor vacío está deshabilitada", await varita.isDisabled());
await shot(page, "f1-01-vacio");

const BORRADOR = "hola si lo tenemos cuesta 2500 y se lo mandamos mañana si quiere";
await ta.fill(BORRADOR);
await hasta(async () => !(await varita.isDisabled()), 3000);
ok("con texto se habilita", !(await varita.isDisabled()));
await varita.click();
const menu = page.getByRole("menu", { name: "Asistente de redacción" });
await menu.waitFor({ timeout: 3000 });
for (const label of ["Mejorar redacción", "Cambiar tono", "Resumir", "Hacer más corto", "Hacer más largo"]) {
  ok(`el menú ofrece «${label}»`, (await menu.getByRole("menuitem", { name: label }).count()) === 1);
}
await menu.getByRole("menuitem", { name: "Cambiar tono" }).click();
for (const label of ["Formal", "Casual", "Empático"]) {
  ok(`tono «${label}»`, (await menu.getByRole("menuitem", { name: label, exact: true }).count()) === 1);
}
await shot(page, "f1-02-menu-tonos");

// Carga: retrasar la respuesta para poder verla.
await page.route("**/api/writing-assist", async (route) => {
  if (route.request().method() !== "POST") return route.continue();
  await sleep(1500);
  return route.continue();
});
await menu.getByRole("menuitem", { name: "Empático", exact: true }).click();
await hasta(async () => (await ta.getAttribute("readonly")) !== null, 1000, 50);
ok("mientras espera, el editor queda en solo lectura", (await ta.getAttribute("readonly")) !== null);
ok("…y se lee «La IA está reescribiendo…»", (await page.getByText("La IA está reescribiendo…").count()) === 1);
ok("…y Enviar está bloqueado", await page.getByRole("button", { name: "Enviar", exact: true }).isDisabled());
await shot(page, "f1-03-cargando");
await hasta(async () => (await ta.inputValue()) !== BORRADOR, 10000);
const empatico = await ta.inputValue();
ok("el texto se reemplaza con el resultado", empatico.startsWith("Entiendo perfectamente"), empatico);
ok("aparece «Deshacer»", (await page.getByRole("button", { name: "Deshacer" }).count()) === 1);
await shot(page, "f1-04-resultado");
await page.unroute("**/api/writing-assist");

await page.getByRole("button", { name: "Deshacer" }).click();
ok("Deshacer devuelve el borrador original", (await ta.inputValue()) === BORRADOR);

// Mejorar.
await varita.click();
await menu.getByRole("menuitem", { name: "Mejorar redacción" }).click();
await hasta(async () => (await ta.inputValue()) !== BORRADOR, 10000);
ok("Mejorar redacción reescribe", /^Hola sí lo tenemos/.test(await ta.inputValue()), await ta.inputValue());
await shot(page, "f1-05-mejorado");

// Fallo: el texto se conserva.
const MALO = "FALLA-IA este texto debe quedarse igual";
await ta.fill(MALO);
await varita.click();
await menu.getByRole("menuitem", { name: "Resumir" }).click();
// (Next monta su propio `role=alert` para anunciar rutas: se busca el texto.)
const alerta = page.getByRole("alert").filter({ hasText: "La IA no pudo procesar el texto" });
await alerta.waitFor({ timeout: 15000 }).catch(() => {});
ok("si falla, se ve el error", (await alerta.count()) === 1);
ok("…y el texto original se conserva", (await ta.inputValue()) === MALO);
ok("…y el editor vuelve a ser editable", (await ta.getAttribute("readonly")) === null);
await shot(page, "f1-06-error");

// Nada se envió.
// (El agente pudo contestar el entrante antes de la pausa: se cuentan solo
// los salientes que no son suyos.)
const salientes = ((await owner.call("GET", `/api/conversations/${conv?.id}/messages`)).json?.messages ?? [])
  .filter((m) => m.direction === "out" && m.origin !== "ai");
ok("el asistente no envió nada al cliente", salientes.length === 0, `${salientes.length} salientes manuales`);
ok("sin errores de página", owner.errors.length === 0, owner.errors.join(" | "));

await owner.call("PATCH", `/api/conversations/${conv?.id}`, { aiEnabled: true });
await browser.close();
console.log(`\n===== ${checks - fails}/${checks} checks OK, ${fails} fallos =====`);
process.exit(fails > 0 ? 1 : 0);
