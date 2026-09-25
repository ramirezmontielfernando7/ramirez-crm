/**
 * Self-test E2E de comportamiento — el compositor de la Bandeja
 * (guion tests/e2e/us1-inbox.md, sección "compositor: emojis, pegar y clip").
 *
 * Conduce la UI real con Playwright:
 *  - el clip único despliega archivo / contacto / ubicación, se cierra al
 *    elegir y al hacer clic fuera, y cada opción hace lo mismo que antes;
 *  - el selector de emojis inserta en la posición del cursor y sus datos los
 *    sirve la instancia (ningún pedido a un CDN);
 *  - Ctrl+V con una imagen la adjunta con preview y se envía; con texto, el
 *    pegado normal no cambia.
 *
 * Uso: node --env-file=.env scripts/e2e-compositor.mjs
 * Requiere: app corriendo (pnpm dev) con WA_MOCK_ENABLED=true y BD migrada.
 * Opcional: E2E_SHOTS=<carpeta> guarda capturas de cada paso.
 * Opcional: PLAYWRIGHT_CHROMIUM=<ruta> si el Chromium de Playwright no está.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.E2E_SHOTS;
const PN = "PN-CMP-1";
const S = Math.random().toString(36).slice(2, 6).toUpperCase();

let failures = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
);
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 820 },
  deviceScaleFactor: SHOTS ? 2 : 1,
});
const req = ctx.request;
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

console.log("== Setup: registro + conexión + una conversación ==");
const email = "e2e@vocero.test";
const password = "password-e2e-123";
let su = await req.post(`${BASE}/api/auth/sign-up/email`, {
  data: { email, password, name: "Operador E2E" },
});
if (!su.ok()) {
  su = await req.post(`${BASE}/api/auth/sign-in/email`, { data: { email, password } });
}
ok("registro o login del operador", su.ok());
const conn = await req.put(`${BASE}/api/settings/whatsapp`, {
  data: { wabaId: "WABA-CMP", phoneNumberId: PN, token: "tok-cmp" },
});
ok("conexión WhatsApp guardada", conn.ok());

const NAME = `Cliente${S}`;
await req.post(`${BASE}/api/dev/wa-mock/inbound`, {
  data: {
    phoneNumberId: PN,
    from: `52155511${Math.floor(1000 + Math.random() * 8999)}`,
    name: NAME,
    text: "hola, ¿me mandas una foto del producto?",
  },
});
let conv = null;
await until(async () => {
  const d = await (await req.get(`${BASE}/api/conversations`)).json();
  conv = (d.conversations ?? []).find((c) => c.contact.name === NAME) ?? null;
  return Boolean(conv);
});
ok("conversación creada por el entrante", Boolean(conv));
if (!conv) {
  await browser.close();
  process.exit(1);
}

const page = await ctx.newPage();
const cdnRequests = [];
page.on("request", (r) => {
  if (/jsdelivr|unpkg|cdnjs/.test(r.url())) cdnRequests.push(r.url());
});
await page.goto(`${BASE}/inbox`);
await page.getByText(NAME).first().click();
const box = page.getByPlaceholder("Escribe una respuesta");
await box.waitFor({ timeout: 30000 });

console.log("\n== El clip único: un botón, un menú con tres opciones ==");
ok(
  "ya no están los botones sueltos de ubicación y contacto",
  (await page.getByRole("button", { name: "Enviar ubicación", exact: true }).count()) === 0 &&
    (await page.getByRole("button", { name: "Compartir contacto", exact: true }).count()) === 0
);
const clip = page.getByRole("button", { name: "Adjuntar", exact: true });
const menu = page.getByRole("menu", { name: "Adjuntar" });
await clip.click();
await menu.waitFor({ timeout: 5000 });
const items = await menu.getByRole("menuitem").allInnerTexts();
ok(
  "el menú trae Archivo, Contacto y Ubicación",
  ["Archivo", "Contacto", "Ubicación"].every((l) => items.some((t) => t.includes(l))),
  JSON.stringify(items)
);
ok("el clip anuncia que está abierto", (await clip.getAttribute("aria-expanded")) === "true");
await sleep(350);
await shot(page, "01-menu-adjuntar");

await page.mouse.click(700, 300);
ok("clic fuera cierra el menú", await until(async () => (await menu.count()) === 0, 3000));

await clip.click();
await menu.waitFor();
await page.keyboard.press("Escape");
ok("Escape cierra el menú", await until(async () => (await menu.count()) === 0, 3000));

await clip.click();
await menu.getByRole("menuitem", { name: /Ubicación/ }).click();
ok("elegir una opción cierra el menú", await until(async () => (await menu.count()) === 0, 3000));
ok(
  "Ubicación abre el mismo formulario de antes",
  await until(async () => (await page.getByText("Coordenadas o enlace de Google Maps").count()) > 0, 3000)
);
await page.getByPlaceholder("21.019, -101.257").fill("21.019, -101.257");
await page.getByRole("button", { name: "Enviar ubicación" }).click();
const outbox = async () =>
  (await (await req.get(`${BASE}/api/dev/wa-mock/outbox`)).json()).outbox ?? [];
ok(
  "y la ubicación sale a WhatsApp como siempre",
  await until(async () =>
    (await outbox()).some(
      (o) => o.type === "location" && JSON.stringify(o.body).includes("-101.257")
    )
  )
);
// El panel se cierra cuando el servidor confirma: hasta entonces, no se toca.
await until(async () => (await page.getByPlaceholder("21.019, -101.257").count()) === 0, 10000);

await clip.click();
await menu.getByRole("menuitem", { name: /Contacto/ }).click();
ok(
  "Contacto abre el mismo formulario de antes",
  await until(async () => (await page.getByPlaceholder("Xavier Pérez").count()) > 0, 3000)
);
await shot(page, "02-panel-contacto");
await page.getByPlaceholder("Xavier Pérez").fill(`Soporte ${S}`);
await page.getByPlaceholder("+52 462 123 4567").fill("+52 462 555 0000");
await page.getByRole("button", { name: "Enviar contacto" }).click();
ok(
  "y el contacto sale a WhatsApp como siempre",
  await until(async () =>
    (await outbox()).some((o) => o.type === "contacts" && JSON.stringify(o.body).includes(S))
  )
);
await until(async () => (await page.getByPlaceholder("Xavier Pérez").count()) === 0, 10000);

await clip.click();
const [chooser] = await Promise.all([
  page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null),
  menu.getByRole("menuitem", { name: /Archivo/ }).click(),
]);
ok("Archivo abre el explorador de archivos", Boolean(chooser));
if (chooser) {
  await chooser.setFiles({
    name: "catalogo.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%catalogo\n"),
  });
  ok(
    "y el archivo queda como adjunto, igual que antes",
    await until(async () => (await page.getByText("catalogo.pdf").count()) > 0, 3000)
  );
  await page.getByRole("button", { name: "Quitar adjunto" }).click();
}

console.log("\n== Emojis: se insertan donde está el cursor ==");
await box.fill("hola  bienvenido");
// Cursor entre los dos espacios (después de "hola ").
await box.evaluate((el) => el.setSelectionRange(5, 5));
await page.getByRole("button", { name: "Emojis", exact: true }).click();
const picker = page.getByRole("dialog", { name: "Elegir emoji" });
// La fila oculta con la que frimousse mide trae emojis sin etiqueta: fuera.
const EMOJI = '[frimousse-emoji]:not([aria-label=""])';
await picker.waitFor({ timeout: 5000 });
const firstEmoji = picker.locator(EMOJI).first();
ok("el selector carga los emojis", await until(async () => (await firstEmoji.count()) > 0, 15000));
await sleep(300);
await shot(page, "03-selector-emojis");
await picker.getByRole("searchbox").fill("corazón");
await until(async () => (await picker.locator(EMOJI).count()) > 0, 5000);
ok(
  "la búsqueda funciona en español",
  (await picker.locator('[frimousse-emoji][aria-label*="corazón" i]').count()) > 0
);
await shot(page, "04-busqueda-corazon");
const heart = picker.locator(EMOJI).first();
const heartChar = (await heart.innerText()).trim();
await heart.click();
ok(
  "el emoji entra en la posición del cursor",
  (await box.inputValue()) === `hola ${heartChar} bienvenido`,
  JSON.stringify(await box.inputValue())
);
const caret = await box.evaluate((el) => el.selectionStart);
ok("el cursor queda justo después del emoji", caret === 5 + heartChar.length, `caret=${caret}`);
await page.mouse.click(700, 300);
ok("clic fuera cierra el selector", await until(async () => (await picker.count()) === 0, 3000));
ok("los datos de emojis no salieron de un CDN", cdnRequests.length === 0, cdnRequests.join(", "));
const data = await req.get(`${BASE}/emojibase/es/data.json`);
ok("la instancia sirve los datos de emojis", data.ok() && (await data.json()).length > 1000);
await box.fill("");

console.log("\n== Ctrl+V: imagen = adjunto con preview; texto = como siempre ==");
// PNG de 1×1 (rojo).
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const paste = (payload) =>
  box.evaluate((el, p) => {
    const dt = new DataTransfer();
    if (p.text) dt.setData("text/plain", p.text);
    if (p.png) {
      const bin = Uint8Array.from(atob(p.png), (c) => c.charCodeAt(0));
      dt.items.add(new File([bin], "image.png", { type: "image/png" }));
    }
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, payload);

const textPrevented = await paste({ text: "precio 1200", png: PNG_B64 });
ok("con texto en el portapapeles el pegado normal sigue (no se intercepta)", !textPrevented);
ok("y no se adjunta nada", (await page.getByRole("button", { name: "Quitar adjunto" }).count()) === 0);

const imgPrevented = await paste({ png: PNG_B64 });
ok("una imagen pegada se intercepta", imgPrevented);
const preview = page.locator('img[alt^="imagen-"]');
ok("y aparece como preview adjunto", await until(async () => (await preview.count()) > 0, 3000));
ok(
  "con un nombre con fecha, no «image.png»",
  /^imagen-\d{14}\.png$/.test((await preview.getAttribute("alt")) ?? ""),
  await preview.getAttribute("alt")
);
await page.getByPlaceholder("Pie del adjunto").fill(`foto pegada ${S}`);
await shot(page, "05-imagen-pegada");
await page.getByRole("button", { name: "Enviar", exact: true }).click();
ok(
  "la imagen pegada se envía como imagen con su pie",
  await until(async () =>
    (await outbox()).some((o) => o.type === "image" && JSON.stringify(o.body).includes(S))
  )
);
ok(
  "el adjunto se limpia tras enviar",
  await until(async () => (await preview.count()) === 0, 5000)
);
await sleep(800);
await shot(page, "06-enviado");

await browser.close();
console.log(`\n${checks - failures}/${checks} checks OK`);
process.exit(failures ? 1 : 0);
