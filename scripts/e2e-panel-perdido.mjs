/**
 * Self-test E2E de navegador — el panel de la Bandeja ya no falla en
 * silencio (tests/e2e/us-panel-errores.md).
 *
 * Bug que cubre: mover un lead a "Perdido" desde el panel de detalles
 * mandaba el PATCH sin motivo; la API respondía 422 `loss_reason_required`
 * y el panel se tragaba el error (`.catch(() => null)`) y regresaba la etapa
 * sin decir nada. Ahora pide el motivo y cualquier fallo se muestra.
 *
 * Uso: app viva con los mocks (`pnpm dev`), después de `pnpm test:e2e` o
 * `pnpm test:e2e:roles` (necesita un contacto con lead en etapa abierta):
 *   node --env-file=.env scripts/e2e-panel-perdido.mjs
 * Sale con 1 si algo falla.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
let fails = 0;
const ok = (n, c, x = "") => {
  console.log(`  ${c ? "OK  " : "FAIL"} ${n}${!c && x ? " — " + x : ""}`);
  if (!c) fails++;
};

// Chromium del entorno si existe (CI/nube); si no, el que instale Playwright.
const browser = await chromium
  .launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" })
  .catch(() => chromium.launch());

const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', "e2e@vocero.test");
await page.fill('input[type="password"]', "password-e2e-123");
await page.click('button[type="submit"]');
await page.waitForURL(/inbox/);
const api = page.request;
await api.put(`${BASE}/api/settings/whatsapp`, { data: { wabaId: "WABA-E2E", phoneNumberId: "PN-E2E", token: "tok-e2e" }, headers: { origin: BASE } });
const stages0 = (await (await api.get(`${BASE}/api/pipeline/stages`)).json()).stages;
const openNames = stages0.filter((s) => s.kind === "open").map((s) => s.name);
const all = (await (await api.get(`${BASE}/api/contacts`)).json()).contacts;
const contact = all.find((c) => c.stageName && openNames.includes(c.stageName));
ok("contacto con lead en etapa abierta", !!contact, JSON.stringify(all.slice(0, 3)));
const stages = (await (await api.get(`${BASE}/api/pipeline/stages`)).json()).stages;
const lost = stages.find((s) => s.kind === "lost");
ok("existe una etapa de pérdida", !!lost, JSON.stringify(stages.map((s) => s.kind)));

await page.goto(`${BASE}/inbox?contact=${contact.id}`);
const moveBtn = page.getByRole("button", { name: `Mover a ${lost.name}` });
await moveBtn.waitFor({ timeout: 20000 });

// 1) Camino infeliz: el servidor falla → el panel lo DICE y no se queda en Perdido.
await page.route("**/api/pipeline/leads/*", (route) =>
  route.request().method() === "PATCH"
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal", message: "Error interno" } }) })
    : route.continue()
);
await moveBtn.click();
await page.getByRole("dialog", { name: "Motivo de pérdida" }).waitFor();
ok("al elegir la etapa perdida se pide el motivo", true);
await page.getByRole("button", { name: "Le pareció caro" }).click();
await page.getByRole("dialog", { name: "Motivo de pérdida" }).getByRole("button").last().click();
const alert = page.getByRole("alert").filter({ hasText: "No se movió la etapa" });
await alert.waitFor({ timeout: 5000 }).catch(() => {});
ok("si el servidor falla, se muestra el error", await alert.isVisible(), await page.locator('[role="alert"]').allInnerTexts().then(String));
await page.unroute("**/api/pipeline/leads/*");
await page.getByRole("button", { name: "Cerrar aviso" }).click();

// 2) Camino feliz: con motivo, se mueve y PERSISTE.
await moveBtn.click();
await page.getByRole("button", { name: "Nunca contestó" }).click();
await page.getByRole("dialog", { name: "Motivo de pérdida" }).getByRole("button").last().click();
let stageId = null;
for (let i = 0; i < 20; i++) {
  stageId = (await (await api.get(`${BASE}/api/contacts/${contact.id}`)).json()).stage?.id;
  if (stageId === lost.id) break;
  await page.waitForTimeout(300);
}
ok("el lead quedó en Perdido en la BD", stageId === lost.id, `stage=${stageId}`);
await page.reload();
await page.getByRole("button", { name: `Mover a ${lost.name}` }).waitFor();
// Solo los avisos del panel: Next.js tiene su propio `role="alert"` (el
// anunciador de rutas) que siempre existe.
const avisos = await page.locator('aside [role="alert"], div[role="alert"]').allInnerTexts();
const errores = avisos.filter((t) => /No se|No se pudo/.test(t));
ok("tras recargar sigue sin avisos de error", errores.length === 0, JSON.stringify(avisos));
ok("sin errores de página", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(fails ? `\n${fails} FALLO(S)` : "\nTODO OK");
process.exit(fails ? 1 : 0);
