/**
 * 10 — Chat de equipo: avisos con reacciones, grupos con menciones de chats
 * de cliente y mensajes que llegan en vivo. Sofía y Diego escriben desde un
 * contexto de navegador headless (fuera de cámara) en momentos programados.
 */
import { chromium } from "playwright";
import { BASE, CHROME, EMAIL, PASSWORD, SEED, login, settle, step, readAlong, mark, clickOn, hover, moveTo, typeText, pressKey, holdUntil, drift, sleep } from "../lib.mjs";

export const meta = { title: "Chat de equipo", subs: "top", startPos: { x: 1150, y: 560 } };

let bg;
const people = {};
async function person(who, ip) {
  const ctx = await bg.newContext({ extraHTTPHeaders: { origin: BASE, "x-forwarded-for": ip } });
  const r = await ctx.request.post(`${BASE}/api/auth/sign-in/email`, { data: { email: EMAIL[who], password: PASSWORD } });
  if (!r.ok()) throw new Error(`login ${who} ${r.status()}`);
  return {
    // No bloquea: el cursor sigue en movimiento mientras el mensaje viaja.
    post(thread, body) {
      mark(`mensaje de ${who}`);
      ctx.request.post(`${BASE}/api/team-chat/threads/${thread}/messages`, { data: { body } })
        .then(async (res) => { if (!res.ok()) console.error("[post]", res.status(), await res.text()); })
        .catch((e) => console.error("[post]", e.message));
    },
  };
}

export async function prepare({ page }) {
  bg = await chromium.launch({ executablePath: CHROME, headless: true });
  people.sofia = await person("sofia", "10.63.0.21");
  people.diego = await person("diego", "10.63.0.22");
  await login(page, "carlos");
  await page.goto(`${BASE}/chat`, { waitUntil: "load" });
  await settle(page, 1200);
}

const thread = (page, name) => page.locator("button", { hasText: name }).first();

export async function run({ page }) {
  const T = SEED().threads;
  const conv = SEED().conv;
  const composer = page.getByPlaceholder("Escribe al equipo…");

  step("Abre el canal de avisos del equipo");
  await clickOn(page, thread(page, "Avisos"), { dx: 0.4, after: 700 });
  await hover(page, page.getByText("¡Felicidades a Diego").first(), { dx: 0.3 });

  step("Comparte archivos con todo el equipo");
  await hover(page, page.getByText("lista-precios-mayoreo.pdf").first(), { dx: 0.3 });
  await readAlong(page, page.getByText("lista de precios de mayoreo de octubre").first(), 1100);

  step("Todo el equipo reacciona a los avisos");
  await hover(page, page.locator("button[aria-label^='🎉']").last());
  await drift(page, { x: 1800, y: 850 }, 700);
  await clickOn(page, page.locator("button[aria-label^='👍']").last(), { after: 700 });

  step("Publica un aviso para los nueve");
  await clickOn(page, composer, { after: 200 });
  await typeText(page, "Mañana llega el pedido de Comex 🎨 ¡A vender!", 70);
  await pressKey(page, "Enter", 1, 200);
  await holdUntil(page, page.getByText("Mañana llega el pedido de Comex").last().waitFor({ timeout: 10000 }), { x: 1650, y: 900 });
  await settle(page, 700);

  step("Grupos con menciones de chats de clientes");
  await clickOn(page, thread(page, "Equipo de ventas"), { dx: 0.4, after: 700 });
  await hover(page, page.locator("button", { hasText: "@Verónica Aguilar" }).last());

  step("Llega un mensaje sin recargar");
  await moveTo(page, 1000, 880, 800);
  await people.diego.post(T.ventas, `Listo, ya quedó la cotización de @[chat:${conv["23"]}] con flete incluido 💪`);
  await holdUntil(page, page.getByText("ya quedó la cotización de").last().waitFor({ timeout: 10000 }), { x: 900, y: 900 });
  await settle(page, 500);
  await hover(page, page.locator("button", { hasText: "@Luis Alfonso Kú" }).last());

  step("Un mensaje directo sube el contador");
  await moveTo(page, 420, 300, 800);
  await people.sofia.post(T.dmSofiaCarlos, "Carlos, ¿revisamos la campaña antes de las 12? 📣");
  await holdUntil(page, page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes("Sofía Ramírez") && x.innerText.includes("revisamos la campaña"));
    return !!b;
  }, null, { timeout: 10000 }), { x: 420, y: 270 });
  await settle(page, 500);
  await clickOn(page, thread(page, "Sofía Ramírez"), { dx: 0.4, after: 600 });

  step("Contesta a Sofía en el directo");
  await clickOn(page, composer, { after: 200 });
  await typeText(page, "Va, te veo a las 11:30 👍", 70);
  await pressKey(page, "Enter", 1, 200);
  await holdUntil(page, page.getByText("te veo a las 11:30").last().waitFor({ timeout: 10000 }), { x: 1650, y: 900 });
  await people.sofia.post(T.dmSofiaCarlos, "¡Perfecto! 🙌");
  step("La conversación llega en tiempo real", { read: true });
  await holdUntil(page, page.getByText("¡Perfecto! 🙌").last().waitFor({ timeout: 10000 }), { x: 800, y: 900 });
  await hover(page, page.getByText("¡Perfecto! 🙌").last(), { dx: 0.5 });
  await sleep(1500);
}

export async function cleanup() {
  await bg?.close();
}
