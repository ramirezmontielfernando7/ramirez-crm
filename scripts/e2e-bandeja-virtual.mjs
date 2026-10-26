/**
 * Self-test E2E — Fluidez PR 2: la lista de la Bandeja es VIRTUAL (solo se
 * dibujan las filas que se ven). Comprueba que con miles de chats todo lo de
 * siempre sigue funcionando:
 *
 *   - pocas filas en el DOM aunque haya 3,000 chats;
 *   - bajar hasta el fondo enseña el último chat;
 *   - las filas no se enciman (las de campaña/anuncio son más altas);
 *   - clic en una fila abre ese chat;
 *   - ↑/↓ con el teclado recorren la lista más allá de lo pintado;
 *   - la búsqueda encuentra un chat que estaba muy abajo;
 *   - `/inbox?contact=…` (enlace desde Contactos/Pipeline) abre el chat
 *     aunque esté en el puesto 2,900 (todavía sin cargar).
 *
 * Fluidez PR 3: la lista llega por PÁGINAS. Además comprueba que solo se
 * pide la primera al entrar, que bajar trae las siguientes sin repetir filas
 * y que los contadores y la búsqueda vienen del servidor.
 *
 * Los chats son FALSOS (como en scripts/medir-fluidez.mjs): el navegador
 * intercepta `GET /api/conversations` y `/counts` con la Bandeja falsa de
 * `scripts/lib/bandeja-falsa.mjs`, así no se siembra la BD.
 *
 * Uso: node --env-file=.env scripts/e2e-bandeja-virtual.mjs
 * Requiere: app corriendo con el .env de pruebas y Playwright.
 */
import { chromium } from "playwright";
import { bandejaFalsa } from "./lib/bandeja-falsa.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const N = 3000;
let failures = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

function chatsFalsos(n) {
  const ahora = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const g = i + 1;
    const last = new Date(ahora - g * 7 * 60_000).toISOString();
    return {
      id: `cvfalso_${g}`,
      channel: "whatsapp",
      contact: { id: `ctfalso_${g}`, name: `Virtual Persona ${g}`, phone: `52133${String(g).padStart(8, "0")}` },
      assignee: null,
      stageName: null,
      stageColor: null,
      leadId: null,
      stageId: null,
      tags: [],
      archivedAt: null,
      aiAvailable: true,
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      lastInboundAt: last,
      lastMessageAt: last,
      createdAt: last,
      unreadCount: 0,
      windowOpen: true,
      windowRemainingMs: 3_600_000,
      preview: "hola",
      anuncio: g % 13 === 0 ? { headline: "Promo", sourceId: "ad_1", sourceType: "ad" } : null,
      campaign: g % 17 === 0 ? { state: "replied", name: "Venta nocturna" } : null,
    };
  });
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "es-MX" });
const req = ctx.request;

console.log("== Setup ==");
let r = await req.post(`${BASE}/api/auth/sign-in/email`, {
  headers: { origin: BASE },
  data: { email: "e2e@vocero.test", password: "password-e2e-123" },
});
if (!r.ok())
  r = await req.post(`${BASE}/api/auth/sign-up/email`, {
    headers: { origin: BASE },
    data: { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" },
  });
ok("login", r.ok());
await req.put(`${BASE}/api/settings/whatsapp`, {
  headers: { origin: BASE },
  data: { wabaId: "WABA-E2E", phoneNumberId: "PN-E2E", token: "tok-e2e" },
});

const chats = chatsFalsos(N);
const stats = await bandejaFalsa(ctx, chats);
const page = await ctx.newPage();
const fila = (g) => page.locator(`[data-conversation-row="cvfalso_${g}"]`);
// ¿La fila está dentro del recuadro visible de la lista?
const aLaVista = (g) =>
  fila(g).evaluate((el) => {
    let caja = el.parentElement;
    while (caja && getComputedStyle(caja).overflowY !== "auto") caja = caja.parentElement;
    if (!caja) return false;
    const a = el.getBoundingClientRect();
    const b = caja.getBoundingClientRect();
    return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  });

console.log(`== Lista virtual con ${N} chats ==`);
await page.goto(`${BASE}/inbox`);
await fila(1).waitFor({ timeout: 60_000 });
const enDom = await page.locator("[data-conversation-row]").count();
ok(`pocas filas en el DOM (${enDom} de ${N})`, enDom > 0 && enDom <= 80);
await page.waitForTimeout(500);
ok(`al entrar se pide UNA página (${stats.paginas})`, stats.paginas === 1);
const todas = page.getByRole("button", { name: /^Filtrar la bandeja/ }).first();
ok("el contador «Todas» es el del servidor (3,000)", /3[,.]?000/.test((await todas.getAttribute("aria-label").catch(() => "")) ?? ""), await todas.getAttribute("aria-label").catch(() => "—"));

// Las filas no se enciman: cada una empieza donde termina la anterior.
await page.evaluate(() => {
  const caja = document.querySelector("[data-conversation-row]")?.closest("ul")?.parentElement;
  if (caja) caja.scrollTop = 84 * 30;
});
await page.waitForTimeout(300);
const encimadas = await page.evaluate(() => {
  const lis = [...document.querySelectorAll("ul > li[data-index]")]
    .map((li) => ({ i: Number(li.dataset.index), r: li.getBoundingClientRect() }))
    .sort((a, b) => a.i - b.i);
  let malas = 0;
  for (let k = 1; k < lis.length; k++) {
    if (lis[k].i !== lis[k - 1].i + 1) continue;
    if (Math.abs(lis[k].r.top - lis[k - 1].r.bottom) > 1) malas++;
  }
  return malas;
});
ok("las filas no se enciman ni dejan huecos (alto medido)", encimadas === 0, `${encimadas} pares`);

// Al fondo: bajar trae las páginas siguientes hasta el último chat.
const alFondo = () =>
  page.evaluate(() => {
    const caja = document.querySelector("[data-conversation-row]")?.closest("ul")?.parentElement;
    if (caja) caja.scrollTop = caja.scrollHeight;
  });
for (let k = 0; k < 200 && (await fila(N).count()) === 0; k++) {
  await alFondo();
  await page.waitForTimeout(100);
}
await alFondo();
await page.waitForTimeout(300);
ok("bajar hasta el fondo enseña el último chat", (await fila(N).count()) === 1 && (await aLaVista(N)));
ok(`las páginas siguientes se pidieron al bajar (${stats.paginas})`, stats.paginas >= N / 50);
const total = await page.evaluate(() => document.querySelector("ul[style]")?.getBoundingClientRect().height ?? 0);
ok("sin filas repetidas (el alto total cuadra con 3,000 filas)", total > 84 * (N - 50) && total < 84 * N * 1.6, String(total));

// Clic: abre ese chat.
const g = N - 2;
await fila(g).locator("[data-row-main]").click();
await page.waitForTimeout(300);
ok(
  "clic en una fila la marca como abierta",
  (await fila(g).getAttribute("class"))?.includes("--bg-active") ?? false
);

console.log("== Teclado ==");
await page.evaluate(() => {
  const caja = document.querySelector("[data-conversation-row]")?.closest("ul")?.parentElement;
  if (caja) caja.scrollTop = 0;
});
await fila(1).waitFor();
await fila(1).locator("[data-row-main]").focus();
for (let k = 0; k < 40; k++) await page.keyboard.press("ArrowDown");
await page.waitForTimeout(200);
const enfocada = await page.evaluate(() =>
  document.activeElement?.closest("[data-conversation-row]")?.getAttribute("data-conversation-row")
);
ok("↓ ×40 deja el foco en el chat 41 (más allá de lo pintado al inicio)", enfocada === "cvfalso_41", String(enfocada));
ok("el chat enfocado está a la vista", await aLaVista(41));
for (let k = 0; k < 5; k++) await page.keyboard.press("ArrowUp");
await page.waitForTimeout(200);
const arriba = await page.evaluate(() =>
  document.activeElement?.closest("[data-conversation-row]")?.getAttribute("data-conversation-row")
);
ok("↑ ×5 regresa al chat 36", arriba === "cvfalso_36", String(arriba));
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
ok("Enter abre el chat enfocado", (await fila(36).getAttribute("class"))?.includes("--bg-active") ?? false);

console.log("== Búsqueda ==");
await page.getByRole("button", { name: /buscar/i }).first().click().catch(() => {});
const campo = page.getByRole("searchbox").or(page.getByPlaceholder(/buscar/i)).first();
await campo.fill("Persona 2500");
await page.waitForTimeout(500);
const tras = await page.locator("[data-conversation-row]").allInnerTexts();
ok("la búsqueda trae el chat 2500", tras.some((t) => t.includes("Virtual Persona 2500")), `${tras.length} filas`);
await campo.fill("");

console.log("== Enlace directo a un chat lejano ==");
await page.goto(`${BASE}/inbox?contact=ctfalso_2900`);
await page.getByRole("heading", { name: "Virtual Persona 2900" }).or(page.locator("header p", { hasText: "Virtual Persona 2900" })).first().waitFor({ timeout: 30_000 }).catch(() => {});
ok(
  "/inbox?contact=… abre el chat 2900 aunque su fila aún no esté cargada",
  (await page.locator("header p", { hasText: "Virtual Persona 2900" }).count()) >= 1
);

await browser.close();
console.log(failures === 0 ? "\nOK" : `\n${failures} fallo(s)`);
process.exit(failures === 0 ? 0 : 1);
