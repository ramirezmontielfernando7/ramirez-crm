/** 14 — Menú lateral en sus tres estados (con animación) y tema claro/oscuro. */
import { BASE, login, settle, sleep, clickOn, hover, moveTo } from "../lib.mjs";

export async function prepare({ page }) {
  await login(page, "carlos");
  await page.goto(`${BASE}/inbox`, { waitUntil: "load" });
  await settle(page, 1500);
  await page.mouse.move(1250, 560);
}

async function cycle(page) {
  await clickOn(page, "button[aria-label='Colapsar el menú']", { pause: 1400 });
  await hover(page, "a[href='/pipeline']", { ms: 600 });
  await sleep(700);
  await clickOn(page, "a[href='/pipeline']", { pause: 1600 });
  await clickOn(page, "button[aria-label='Ocultar el menú']", { pause: 1600 });
  await moveTo(page, 900, 520, 800);
  await sleep(900);
  await clickOn(page, "button[aria-label='Mostrar el menú']", { pause: 1600 });
}

export async function run({ page }) {
  await sleep(900);
  await cycle(page);
  await clickOn(page, "a[href='/results']", { pause: 1600 });
  // Tema oscuro.
  const tema = page.locator("button[aria-label^='Tema:']");
  for (let i = 0; i < 3; i++) {
    await clickOn(page, tema, { pause: 1300 });
    if ((await tema.getAttribute("aria-label"))?.includes("Oscuro")) break;
  }
  await clickOn(page, "a[href='/inbox']", { pause: 1500 });
  await clickOn(page, page.locator("button", { hasText: "Ing. Alejandro Ramos" }).first(), { pause: 1600 });
  await clickOn(page, "button[aria-label='Colapsar el menú']", { pause: 1400 });
  await clickOn(page, "button[aria-label='Ocultar el menú']", { pause: 1400 });
  await clickOn(page, "button[aria-label='Mostrar el menú']", { pause: 1400 });
  for (let i = 0; i < 3; i++) {
    await clickOn(page, tema, { pause: 1300 });
    if ((await tema.getAttribute("aria-label"))?.includes("Claro")) break;
  }
  await moveTo(page, 1100, 520, 900);
  await sleep(1200);
}
