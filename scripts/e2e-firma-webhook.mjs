/**
 * Self-test E2E — firma del webhook de WhatsApp (tests/e2e/us-firma-webhook.md).
 *
 * Conduce la app REAL en el modo que tenga el servidor:
 *   - SIN META_APP_SECRET: Ajustes → WhatsApp muestra "Firma no verificada"
 *     y un evento sin firma se acepta (200): la instancia no se rompe;
 *   - CON META_APP_SECRET: Ajustes → WhatsApp dice "Verificación de firma
 *     activa", un evento sin firma o con firma falsa → 401, y uno firmado → 200.
 * Con SERVER_LOG=<archivo> comprueba además la advertencia de arranque.
 *
 * El modo se deduce de META_APP_SECRET en el entorno del script (el mismo
 * .env que el servidor). Nunca imprime valores de variables ni la URL del
 * webhook (lleva el token secreto).
 *
 * Uso: app viva con los mocks (`pnpm dev`), después de `pnpm test:e2e`:
 *   node --env-file=.env scripts/e2e-firma-webhook.mjs
 * Re-ejecutable. Sale con 1 si algo falla.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.META_APP_SECRET || "";
const CON_SECRETO = SECRET.length > 0;
const OWNER = { email: "e2e@vocero.test", password: "password-e2e-123" };

let fails = 0;
const ok = (n, c, x = "") => {
  console.log(`  ${c ? "OK  " : "FAIL"} ${n}${!c && x ? " — " + x : ""}`);
  if (!c) fails++;
};

console.log(`\n== Firma del webhook — modo ${CON_SECRETO ? "CON" : "SIN"} META_APP_SECRET ==`);

const browser = await chromium
  .launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" })
  .catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${BASE}/login`);
await page.fill('input[type="email"]', OWNER.email);
await page.fill('input[type="password"]', OWNER.password);
await page.click('button[type="submit"]');
const entro = await page.waitForURL(/inbox/, { timeout: 30000 }).then(() => true, () => false);
ok("el propietario inicia sesión (corre antes pnpm test:e2e)", entro);

/* ── 1 · API de Ajustes ─────────────────────────────────────────── */
const info = await ctx.request.get(`${BASE}/api/settings/webhook`, { headers: { origin: BASE } });
const webhook = await info.json().catch(() => null);
ok("GET /api/settings/webhook → 200", info.status() === 200, `status=${info.status()}`);
ok(
  `signatureLayer = ${CON_SECRETO}`,
  webhook?.signatureLayer === CON_SECRETO,
  `signatureLayer=${webhook?.signatureLayer}`
);

/* ── 2 · Pantalla Ajustes → WhatsApp ────────────────────────────── */
await page.goto(`${BASE}/settings/whatsapp`);
const aviso = page.getByTestId("webhook-firma-no-verificada");
if (CON_SECRETO) {
  const activa = await page
    .getByText("Verificación de firma activa")
    .waitFor({ timeout: 15000 })
    .then(() => true, () => false);
  ok("se ve «Verificación de firma activa»", activa);
  ok("NO se ve el aviso de firma no verificada", (await aviso.count()) === 0);
} else {
  const visible = await aviso.waitFor({ timeout: 15000 }).then(() => true, () => false);
  ok("se ve el aviso «Firma no verificada»", visible);
  if (visible) {
    const texto = await aviso.innerText();
    ok("el aviso dice qué hacer (META_APP_SECRET)", texto.includes("META_APP_SECRET"));
  }
}
ok("sin errores de página", errors.length === 0, errors.join(" | "));

/* ── 3 · El webhook de verdad ───────────────────────────────────── */
const url = webhook?.url;
const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
const enviar = async (headers = {}) =>
  (
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    })
  ).status;
const firmar = (s) => `sha256=${createHmac("sha256", s).update(body, "utf8").digest("hex")}`;

if (typeof url === "string") {
  if (CON_SECRETO) {
    ok("evento sin firma → 401", (await enviar()) === 401);
    ok("evento con firma falsa → 401", (await enviar({ "x-hub-signature-256": firmar("otro") })) === 401);
    ok("evento firmado con el App Secret → 200", (await enviar({ "x-hub-signature-256": firmar(SECRET) })) === 200);
  } else {
    ok("evento sin firma → 200 (la instancia sigue recibiendo)", (await enviar()) === 200);
  }
} else {
  ok("la URL del webhook viene en Ajustes", false);
}

/* ── 4 · Advertencia de arranque ────────────────────────────────── */
if (process.env.SERVER_LOG) {
  const log = readFileSync(process.env.SERVER_LOG, "utf8");
  const avisa = log.includes("[boot] META_APP_SECRET no está definido");
  ok(
    CON_SECRETO ? "el arranque NO advierte (hay secreto)" : "el arranque advierte que la firma no se verifica",
    CON_SECRETO ? !avisa : avisa
  );
  if (CON_SECRETO) ok("el secreto no aparece en el log", !log.includes(SECRET));
}

await browser.close();
console.log(fails ? `\n${fails} FALLA(S)` : "\nTODO VERDE");
process.exit(fails ? 1 : 0);
