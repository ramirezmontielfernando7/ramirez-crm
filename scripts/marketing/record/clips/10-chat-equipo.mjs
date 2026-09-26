/**
 * 10 — Chat de equipo: avisos con reacciones de los 9, grupos con menciones de
 * chats de cliente y adjuntos, directos y mensajes que llegan en vivo. Sofía y
 * Diego escriben desde contextos de navegador headless (fuera de cámara).
 */
import path from "node:path";
import { chromium } from "playwright";
import { BASE, CHROME, EMAIL, PASSWORD, OUT, SEED, login, settle, sleep, clickOn, hover, moveTo, typeHuman, smoothScroll } from "../lib.mjs";

let bg;
const people = {};

async function person(who, ip) {
  const ctx = await bg.newContext({ extraHTTPHeaders: { origin: BASE, "x-forwarded-for": ip } });
  const r = await ctx.request.post(`${BASE}/api/auth/sign-in/email`, { data: { email: EMAIL[who], password: PASSWORD } });
  if (!r.ok()) throw new Error(`login ${who} ${r.status()}`);
  return {
    async post(thread, body) {
      const res = await ctx.request.post(`${BASE}/api/team-chat/threads/${thread}/messages`, { data: { body } });
      if (!res.ok()) throw new Error(`post ${res.status()} ${await res.text()}`);
    },
  };
}

export async function prepare({ page }) {
  bg = await chromium.launch({ executablePath: CHROME, headless: true });
  people.sofia = await person("sofia", "10.63.0.21");
  people.diego = await person("diego", "10.63.0.22");
  await login(page, "carlos");
  await page.goto(`${BASE}/inbox`, { waitUntil: "load" });
  await settle(page, 1500);
  await page.mouse.move(1250, 560);
}

const thread = (name) => page_.locator("button", { hasText: name }).first();
let page_;

export async function run({ page }) {
  page_ = page;
  const T = SEED().threads;
  const conv = SEED().conv;
  await sleep(1000);

  // 1) Desde la Bandeja: Sofía publica un aviso → el globo del menú sube.
  await hover(page, "a[href='/chat']");
  await sleep(500);
  await people.sofia.post(T.avisos, "📦 Llegó el pedido de Comex: 40 cubetas de vinílica blanca ya están en bodega.");
  await sleep(2200);
  await clickOn(page, "a[href='/chat']", { pause: 1200 });

  // 2) Avisos: todo el equipo reacciona.
  await clickOn(page, thread("Avisos"), { pause: 1400 });
  await moveTo(page, 1200, 520, 700);
  await smoothScroll(page, null, 0, 10);
  const scrollHost = await page.evaluate(() => {
    const els = [...document.querySelectorAll("main *, div")].filter((e) => e.scrollHeight > e.clientHeight + 50 && getComputedStyle(e).overflowY !== "visible" && e.getBoundingClientRect().left > 500);
    els.at(-1)?.setAttribute("data-rec-thread", "1");
    return els.length;
  });
  if (scrollHost) {
    await smoothScroll(page, "[data-rec-thread]", -900, 1800);
    await sleep(1400);
    await smoothScroll(page, "[data-rec-thread]", 900, 1500);
  }
  await settle(page, 900);
  const chip = page.locator("button[aria-label^='👍']").last();
  if (await chip.count()) await clickOn(page, chip, { pause: 1000 });
  const composer = page.getByPlaceholder("Escribe al equipo…");
  await clickOn(page, composer, { pause: 400 });
  await typeHuman(page, "¡Gracias Sofía! Ofrézcanla hoy con el flete gratis 🚚", 40);
  await page.keyboard.press("Enter");
  await settle(page, 1400);

  // 3) Equipo de ventas: menciones de chats de cliente y un mensaje en vivo.
  await clickOn(page, thread("Equipo de ventas"), { pause: 1400 });
  const mention = page.locator("button", { hasText: "@Arq. Beatriz Solís" }).first();
  if (await mention.count()) await hover(page, mention, { ms: 900 });
  await sleep(1200);
  await people.diego.post(T.ventas, `Listo, ya quedó la cotización de @[chat:${conv["23"]}] con flete incluido 💪`);
  await sleep(2400);
  await hover(page, page.locator("button", { hasText: "@Luis Alfonso Kú" }).last(), { ms: 900 });
  await sleep(800);

  // 4) Adjunto: Carlos comparte el catálogo en PDF.
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    clickOn(page, "button[aria-label='Adjuntar archivo']", { pause: 300 }),
  ]);
  await chooser.setFiles(path.join(OUT, ".assets/catalogo-el-martillo.pdf"));
  await settle(page, 900);
  await clickOn(page, composer, { pause: 300 });
  await typeHuman(page, "Catálogo actualizado para sus clientes 📄", 40);
  await page.keyboard.press("Enter");
  await settle(page, 1600);

  // 5) Directo: Sofía escribe mientras Carlos está en otro hilo.
  await clickOn(page, thread("Coordinación"), { pause: 1000 });
  await people.sofia.post(T.dmSofiaCarlos, "Carlos, ¿revisamos la campaña de impermeabilizante antes de las 12? 📣");
  await sleep(2400);
  await clickOn(page, thread("Sofía Ramírez"), { pause: 1400 });
  await clickOn(page, composer, { pause: 300 });
  await typeHuman(page, "Va, te veo a las 11:30 👍", 45);
  await page.keyboard.press("Enter");
  await settle(page, 1200);
  await people.sofia.post(T.dmSofiaCarlos, "¡Perfecto! 🙌");
  await sleep(2600);
}

export async function cleanup() {
  await bg?.close();
}
