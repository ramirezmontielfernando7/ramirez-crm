/**
 * Capturas: reparto por turnos (Ajustes → Equipo) y «Productividad por asesor»
 * (Resultados → Atención). App local con mocks. SHOTS_DIR=<carpeta>.
 * Requiere los asesores de scripts/e2e-roles.mjs.
 */
import { chromium } from "playwright";
const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOTS_DIR ?? "capturas-reparto";
const RUN = Date.now().toString().slice(-6);
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-MX", extraHTTPHeaders: { origin: BASE, "x-forwarded-for": `10.97.${Number(RUN.slice(-3)) % 256}.1` } });
const call = async (m, p, data) => {
  const r = await ctx.request.fetch(`${BASE}${p}`, { method: m, data, failOnStatusCode: false, timeout: 120000 });
  return { status: r.status(), json: await r.json().catch(() => null) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const li = await call("POST", "/api/auth/sign-in/email", { email: "e2e@vocero.test", password: "password-e2e-123" });
if (li.status >= 400) throw new Error(`login ${li.status}`);
await call("PUT", "/api/settings/chat-visibility", { view: "all" });
await call("PUT", "/api/settings/assignment-mode", { mode: "round_robin" });
const sets = (await call("GET", "/api/settings/whatsapp")).json?.connection;
const nums = (await call("GET", "/api/whatsapp-numbers")).json?.numbers ?? [];
const pn = sets?.phoneNumberId ?? nums[0]?.id;
const clientes = ["Roberto Chan", "Lucía Pérez", "Mario Dzul", "Elena Poot", "Pablo Canché", "Rosa Ek"];
for (const [i, n] of clientes.entries()) {
  await call("POST", "/api/dev/wa-mock/inbound", { phoneNumberId: pn, from: `52998${RUN}${i}`, name: n, text: "Hola, quiero información" });
  await sleep(400);
}
await sleep(2500);
const convs = (await call("GET", "/api/conversations")).json?.conversations ?? [];
// El dueño contesta solo a la mitad, para que se vean contestados y pendientes.
for (const c of convs.filter((c) => clientes.includes(c.contact.name)).slice(0, 3)) {
  await call("POST", `/api/conversations/${c.id}/messages`, { text: "¡Hola! Con gusto te ayudo." });
}
await sleep(1500);
const page = await ctx.newPage();
await page.goto(`${BASE}/settings/team`, { waitUntil: "load", timeout: 180000 });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await page.getByTestId("assignment-mode-card").waitFor({ timeout: 90000 });
await page.getByTestId("assignment-mode-card").scrollIntoViewIfNeeded();
await sleep(800);
await page.screenshot({ path: `${OUT}/1-ajustes-reparto-por-turnos.png` });
await page.goto(`${BASE}/inbox`, { waitUntil: "load" });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await page.locator("[data-row-name]").first().waitFor({ timeout: 90000 });
await sleep(2500);
await page.screenshot({ path: `${OUT}/2-bandeja-chats-repartidos.png` });
await page.goto(`${BASE}/results`, { waitUntil: "load" });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await page.getByRole("tab", { name: "Atención" }).click({ timeout: 90000 });
await page.getByTestId("team-panel").waitFor({ timeout: 90000 });
await page.getByTestId("team-panel").scrollIntoViewIfNeeded();
await sleep(1000);
await page.screenshot({ path: `${OUT}/3-productividad-por-asesor.png` });
console.log("panel:", (await page.getByTestId("team-panel").innerText()).replace(/\n+/g, " | "));
await call("PUT", "/api/settings/assignment-mode", { mode: "manual" });
await call("PUT", "/api/settings/chat-visibility", { view: "own" });
await browser.close();
console.log("listo");
