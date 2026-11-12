/**
 * Capturas y video de la Bandeja con DOS números oficiales, cada uno con su
 * color, con el menú lateral expandido y colapsado. Contra la app local con
 * mocks (WA_MOCK_ENABLED=true). Usa una organización nueva para que la
 * bandeja salga limpia.
 *
 *   SHOTS_DIR=<carpeta> node --env-file=.env scripts/capturas-varios-numeros.mjs
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOTS_DIR ?? "capturas-numeros";
const RUN = "7" + Date.now().toString().slice(-5);
const PN1 = `PN-VN1-${RUN}`;
const PN2 = `PN-VN2-${RUN}`;
const WABA = `WABA-VN-${RUN}`;
const USER = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "es-MX",
  colorScheme: "light",
  extraHTTPHeaders: { "x-forwarded-for": `10.98.${Number(RUN.slice(-3)) % 256}.1`, origin: BASE },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("vocero.panelOpen", "false");
  } catch {}
});
const call = async (method, path, data) => {
  const res = await ctx.request.fetch(`${BASE}${path}`, { method, data, failOnStatusCode: false, timeout: 180000 });
  return { status: res.status(), json: await res.json().catch(() => null) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let r = await call("POST", "/api/auth/sign-up/email", USER);
if (r.status >= 400) r = await call("POST", "/api/auth/sign-in/email", USER);
console.log("sesión", r.status);

// Base local de pruebas: se vacía la bandeja y se dejan solo los dos números.
await call("PUT", "/api/preferences", { navMode: "expanded" }); // el menú empieza expandido
const previos = (await call("GET", "/api/settings/whatsapp")).json?.numbers ?? [];
for (const c of (await call("GET", "/api/conversations")).json?.conversations ?? []) await call("DELETE", `/api/conversations/${c.id}`);
// El mock de Meta aprende qué números tiene un token al preguntarle por ellos.
for (const pn of [PN1, PN2]) await fetch(`${BASE}/api/dev/wa-mock/graph/${pn}?fields=id`, { headers: { authorization: `Bearer tok-cap-${RUN}` } });
let put1 = await call("PUT", "/api/settings/whatsapp", { wabaId: WABA, phoneNumberId: PN1, token: `tok-cap-${RUN}`, label: "Ventas Cancún", color: "verde" });
if (put1.status >= 400) put1 = await call("PUT", "/api/settings/whatsapp", { wabaId: WABA, phoneNumberId: PN1, token: `tok-cap-${RUN}`, label: "Ventas Cancún", color: "verde" });
console.log("PUT1", put1.status);
let put2 = await call("PUT", "/api/settings/whatsapp", { wabaId: WABA, phoneNumberId: PN2, token: `tok-cap-${RUN}`, label: "Sucursal Mérida", color: "morado" });
if (put2.status >= 400) put2 = await call("PUT", "/api/settings/whatsapp", { wabaId: WABA, phoneNumberId: PN2, token: `tok-cap-${RUN}`, label: "Sucursal Mérida", color: "morado" });
console.log("PUT2", put2.status);

for (const p of previos) await call("DELETE", `/api/settings/whatsapp/numbers/${encodeURIComponent(p.phoneNumberId)}`);
const clientes = [
  [PN1, "María Fernanda López", "Hola, ¿tienen disponibilidad para este fin de semana en Cancún?"],
  [PN2, "Carlos Pech", "Buenas tardes, quiero cotizar para 20 personas en Mérida"],
  [PN1, "Ana Sofía Ruiz", "¿Cuánto cuesta el paquete con hospedaje?"],
  [PN2, "Luis Canul", "Me interesa la promoción que vi en Instagram"],
  [PN1, "Jorge Herrera", "Necesito factura de mi compra anterior"],
  [PN2, "Daniela Cetina", "¿Atienden los domingos?"],
];
for (const [pn, name, text] of clientes) {
  const from = `52999${Math.floor(1000000 + Math.random() * 8999999)}`;
  await call("POST", "/api/dev/wa-mock/inbound", { phoneNumberId: pn, from, name, text });
  await sleep(300);
}
await sleep(2500);

const page = await ctx.newPage();
await page.goto(`${BASE}/inbox`, { waitUntil: "load", timeout: 180000 });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await page.locator("[data-number-chip]").first().waitFor({ timeout: 90000 });
await sleep(800);
const shot = async (name) => {
  await sleep(1500);
  if (page.url().includes("/inbox") && (await page.locator("[data-pm=chat-head]").count())) {
    await page.getByText("Hoy", { exact: true }).first().waitFor({ timeout: 15000 }).catch(() => {});
  }
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
  console.log("  ✓", name);
};

const toggle = () => page.getByRole("button", { name: /Colapsar el menú|Ocultar el menú/ }).first();
// 1) Menú expandido
await shot("1-bandeja-menu-expandido");
await page.locator("[data-row-name]", { hasText: "Carlos Pech" }).first().click();
await page.getByText("Buenas tardes, quiero cotizar para 20 personas en Mérida").last().waitFor({ timeout: 30000 });
await page.locator("[data-pm=chat-head] [data-number-chip]").first().waitFor({ timeout: 30000 });
await shot("2-chat-merida-menu-expandido");
// 2) Menú colapsado
await toggle().click();
await shot("3-chat-merida-menu-colapsado");
await page.locator("[data-row-name]", { hasText: "María Fernanda" }).first().click();
await page.getByText("Hola, ¿tienen disponibilidad para este fin de semana en Cancún?").last().waitFor({ timeout: 30000 });
await page.locator("[data-pm=chat-head] [data-number-chip]", { hasText: "Ventas Cancún" }).first().waitFor({ timeout: 30000 });
await shot("4-chat-cancun-menu-colapsado");
// 3) Filtro por número
await page.getByRole("button", { name: /Filtrar la bandeja/ }).click();
await shot("5-filtro-numero-menu-colapsado");
await page.getByLabel("Filtrar por número de WhatsApp").selectOption(PN2);
await sleep(800);
await page.keyboard.press("Escape");
await page.locator("[data-row-name]", { hasText: "Carlos Pech" }).first().click();
await page.getByText("Buenas tardes, quiero cotizar para 20 personas en Mérida").last().waitFor({ timeout: 30000 });
await shot("6-solo-merida-menu-colapsado");
// 4) Ajustes: elegir el color
await page.goto(`${BASE}/settings/whatsapp`, { waitUntil: "load" });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await page.locator("[data-testid=numero-color]").first().waitFor({ timeout: 90000 });
await shot("7-ajustes-nombre-y-color-menu-colapsado");
await sleep(1200);

await ctx.close();
await browser.close();
console.log("Listo en", OUT);
