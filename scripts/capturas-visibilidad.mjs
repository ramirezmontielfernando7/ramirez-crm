/**
 * Capturas: Ajustes → «Qué chats ven los asesores» y, como asesor, el botón
 * «Tomar este chat». App local con mocks. SHOTS_DIR=<carpeta>.
 */
import { chromium } from "playwright";
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOTS_DIR ?? "capturas-visibilidad";
const RUN = Date.now().toString().slice(-6);
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
async function sesion(email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-MX", extraHTTPHeaders: { origin: BASE, "x-forwarded-for": `10.99.${Number(RUN.slice(-3)) % 256}.${email.length}` } });
  const r = await ctx.request.fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", data: { email, password }, failOnStatusCode: false });
  if (!r.ok()) throw new Error(`login ${email}: ${r.status()}`);
  return ctx;
}
const owner = await sesion("e2e@vocero.test", "password-e2e-123");
await owner.request.fetch(`${BASE}/api/settings/chat-visibility`, { method: "PUT", data: { view: "unassigned" } });
const nums = (await (await owner.request.fetch(`${BASE}/api/whatsapp-numbers`)).json()).numbers ?? [];
const sets = (await (await owner.request.fetch(`${BASE}/api/settings/whatsapp`)).json()).connection;
const pn = sets?.phoneNumberId ?? nums[0]?.id;
for (const [n, t] of [["Roberto Chan", "Hola, ¿tienen disponibilidad?"], ["Lucía Pérez", "Quiero una cotización"]]) {
  await owner.request.fetch(`${BASE}/api/dev/wa-mock/inbound`, { method: "POST", data: { phoneNumberId: pn, from: `52999${RUN}${n.length}`, name: n, text: t } });
}
await new Promise((r) => setTimeout(r, 2500));
let p = await owner.newPage();
await p.goto(`${BASE}/settings/team`, { waitUntil: "load" });
await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await p.getByTestId("chat-visibility-card").waitFor({ timeout: 90000 });
await p.getByTestId("chat-visibility-card").scrollIntoViewIfNeeded();
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/1-ajustes-que-chats-ven-los-asesores.png` });
const asesor = await sesion("asesor.a.e2e@vocero.test", "password-e2e-roles-123");
p = await asesor.newPage();
await p.goto(`${BASE}/inbox`, { waitUntil: "load" });
await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await p.locator("[data-row-name]", { hasText: "Roberto Chan" }).first().click({ timeout: 90000 });
await p.getByTestId("claim-chat").waitFor({ timeout: 30000 });
await p.getByText("Hoy", { exact: true }).first().waitFor({ timeout: 30000 });
await p.waitForTimeout(3500);
console.log("head:", (await p.locator("[data-pm=chat-head]").innerText().catch(() => "sin head")).replace(/\n/g, " | "));
await p.screenshot({ path: `${OUT}/2-asesor-ve-sin-asignar-y-tomar-chat.png` });
await p.getByTestId("claim-chat").click();
await p.getByTestId("claim-chat").waitFor({ state: "detached", timeout: 30000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/3-asesor-ya-tomo-el-chat.png` });
await owner.request.fetch(`${BASE}/api/settings/chat-visibility`, { method: "PUT", data: { view: "own" } });
await browser.close();
console.log("listo");
