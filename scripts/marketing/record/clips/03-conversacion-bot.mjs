/**
 * 03 — El bot atiende a una clienta nueva (saludo, precio, horario), el
 * Propietario asigna el chat a Diego, la clienta pide un asesor → handoff con
 * aviso, y Diego (su propia ventana) toma el chat y responde.
 */
import { BASE, login, settle, sleep, clickOn, hover, moveTo, typeHuman, inbound, phone, newContext, fullscreen } from "../lib.mjs";

const CLIENTA = { from: phone(74), name: "Mariela Poot" };
let diego;

export async function prepare({ browser, page }) {
  // Ventana de Diego (asesor): lista y preparada detrás.
  const ctxD = await newContext(browser, { ip: "10.62.0.44" });
  diego = await ctxD.newPage();
  await fullscreen(diego);
  await login(diego, "diego");
  await diego.goto(`${BASE}/inbox`, { waitUntil: "load" });
  await settle(diego, 1000);
  await diego.mouse.move(1250, 560);

  await page.bringToFront();
  await login(page, "carlos");
  await page.goto(`${BASE}/inbox`, { waitUntil: "load" });
  await settle(page, 1500);
  await page.mouse.move(1250, 560);
}

async function waitBot(page, text, ms = 15000) {
  await page.getByText(text, { exact: false }).last().waitFor({ timeout: ms });
  await settle(page, 1200);
}

export async function run({ page }) {
  await sleep(1000);
  await inbound({ ...CLIENTA, text: "Hola, buenas tardes" });
  const row = page.locator("button", { hasText: "Mariela Poot" }).first();
  await row.waitFor({ timeout: 10000 });
  await settle(page, 900);
  await clickOn(page, row, { pause: 1000 });
  await waitBot(page, "Soy Martillito");
  await moveTo(page, 1100, 700, 800);

  await inbound({ ...CLIENTA, text: "¿Cuánto cuesta el bulto de cemento?" });
  await waitBot(page, "bulto de cemento gris de 50 kg");
  await sleep(1400);
  await inbound({ ...CLIENTA, text: "¿Y a qué hora abren el domingo?" });
  await waitBot(page, "domingos de 9:00 a 14:00");
  await sleep(1400);

  // El Propietario asigna el chat a Diego.
  const asignar = page.locator("select[aria-label='Asignar a']");
  await hover(page, asignar);
  await sleep(400);
  await asignar.selectOption({ label: "Diego López" });
  await settle(page, 1800);

  // Cambio a la ventana de Diego: el chat ya le llegó.
  await diego.bringToFront();
  await settle(diego, 1000);
  const rowD = diego.locator("button", { hasText: "Mariela Poot" }).first();
  await rowD.waitFor({ timeout: 10000 });
  await clickOn(diego, rowD, { pause: 1200 });
  await moveTo(diego, 1100, 650, 800);

  // La clienta pide un asesor: el bot se despide y suelta el chat (handoff).
  await inbound({ ...CLIENTA, text: "Perfecto. ¿Me puede atender un asesor? Necesito factura" });
  await waitBot(diego, "te comunico con una persona");
  await sleep(2600);

  // Diego toma el chat y responde.
  const composer = diego.getByPlaceholder("Escribe una respuesta…");
  await clickOn(diego, composer, { pause: 500 });
  await typeHuman(diego, "¡Hola Mariela! Soy Diego, con gusto te ayudo con tu factura 🧾 ¿Me compartes tu RFC?", 38);
  await sleep(500);
  await clickOn(diego, "button[aria-label='Enviar']", { pause: 2600 });
}

export async function cleanup() {
  await diego?.context().close();
}
