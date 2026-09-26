/**
 * 02 — Bandeja: lista llena, filtros, búsqueda, no leídos y mensajes entrando
 * en vivo con el globo del menú en sus tres estados.
 */
import { BASE, login, settle, hold, holdUntil, clickOn, hover, moveTo, typeHuman, smoothScroll, inbound, phone } from "../lib.mjs";

export async function prepare({ page }) {
  await login(page, "carlos");
  await page.goto(`${BASE}/inbox`, { waitUntil: "load" });
  await settle(page, 1500);
  await page.mouse.move(1250, 560);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("button")].find((b) => b.innerText.includes("Arq. Beatriz Solís"));
    let el = row?.parentElement;
    while (el && el.scrollHeight <= el.clientHeight + 5) el = el.parentElement;
    el?.setAttribute("data-rec-list", "1");
  });
}

/** Llega un mensaje: el cursor va a la cima de la lista, donde aparece la fila, y luego al globo. */
async function arrive(page, n, name, text) {
  await inbound({ from: phone(n), name, text });
  const top = page.locator("[data-rec-list] button").first();
  await holdUntil(page, page.waitForFunction((nm) => {
    const b = document.querySelector("[data-rec-list] button");
    return b?.innerText.includes(nm);
  }, name, { timeout: 15000 }), { x: 430, y: 92 });
  await hover(page, top, { dx: 0.45, ms: 450 });
  await hold(page, 900);
}

export async function run({ page }) {
  await hold(page, 900, { x: 900, y: 420 });
  // Recorrido por la lista llena: el cursor acompaña el scroll.
  await hover(page, page.locator("button", { hasText: "Arq. Beatriz Solís" }).first());
  await Promise.all([smoothScroll(page, "[data-rec-list]", 1400, 2200), moveTo(page, 430, 820, 2100)]);
  await hold(page, 700);
  await Promise.all([smoothScroll(page, "[data-rec-list]", -1400, 1700), moveTo(page, 430, 260, 1600)]);
  await settle(page, 800);

  // Filtros: No leídas → Atención humana → Anuncios → quién atiende.
  const filtro = page.locator("button[aria-label^='Filtrar la bandeja']");
  await clickOn(page, filtro);
  await clickOn(page, page.getByRole("button", { name: /^No leídas/ }), { pause: 1400 });
  await clickOn(page, filtro);
  await clickOn(page, page.getByRole("button", { name: /^Atención humana/ }), { pause: 1400 });
  await clickOn(page, filtro);
  await clickOn(page, page.getByRole("button", { name: /^Anuncios/ }), { pause: 1400 });
  await clickOn(page, filtro);
  await clickOn(page, page.getByRole("button", { name: /^Todas/ }).last(), { pause: 500 });
  await clickOn(page, filtro);
  const quien = page.locator("select[aria-label='Filtrar por persona asignada']");
  await hover(page, quien);
  await quien.selectOption({ label: "Sin asignar" });
  await settle(page, 900);
  await hover(page, page.locator("[data-rec-list] button").first(), { dx: 0.4 }).catch(() => {});
  await hold(page, 700);
  await hover(page, quien);
  await quien.selectOption({ index: 0 });
  await settle(page, 500);
  await page.keyboard.press("Escape");
  await settle(page, 500);

  // Búsqueda por nombre.
  await clickOn(page, "button[aria-label='Buscar conversación (/)']", { pause: 500 });
  await typeHuman(page, "Ramos", 110);
  await settle(page, 600);
  await hover(page, page.locator("[data-rec-list] button").first(), { dx: 0.4, ms: 600 }).catch(() => {});
  await hold(page, 800);
  await moveTo(page, 400, 28, 500);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Backspace");
    await new Promise((r) => setTimeout(r, 70));
  }
  await settle(page, 500);
  await page.keyboard.press("Escape");
  await page.locator("button[aria-label='Buscar conversación (/)']").blur().catch(() => {});
  await settle(page, 500);

  // En vivo: llegan mensajes, la fila sube y el globo del menú suma.
  await hover(page, "a[href='/inbox']");
  await hold(page, 500);
  await arrive(page, 7, "Hugo Sánchez", "Va, mándame la cotización con el sellador 👍");
  await arrive(page, 26, "Teresa Hernández", "Sí, apártame el flotador, paso en la tarde");
  await arrive(page, 73, "Karina Pech", "Hola, ¿tienen malla electrosoldada?");
  await hover(page, "a[href='/inbox']", { ms: 600 });
  await hold(page, 800);

  // Menú angosto: el globo queda como punto.
  await clickOn(page, "button[aria-label='Colapsar el menú']", { pause: 1000 });
  await arrive(page, 11, "Fernando Castillo", "¿Ya te confirmaron el precio de las 3 toneladas?");
  await hover(page, "a[href='/inbox']", { ms: 600 });
  await hold(page, 900);

  // Menú oculto: la lista sigue viva sin el lateral.
  await clickOn(page, "button[aria-label='Ocultar el menú']", { pause: 1000 });
  await arrive(page, 17, "Alberto Jiménez", "También ocupo 20 chalupas y cinta de aislar");

  // De vuelta al menú completo: el globo ya suma todo lo que llegó.
  await clickOn(page, "button[aria-label='Mostrar el menú']", { pause: 1000 });
  await hover(page, "a[href='/inbox']", { ms: 600 });
  await hold(page, 1600);
}
