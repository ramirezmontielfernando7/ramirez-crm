/**
 * 02 — Bandeja: lista llena, filtros, búsqueda, no leídos y mensajes entrando
 * en vivo con el globo del menú en sus tres estados.
 */
import { BASE, login, settle, sleep, clickOn, hover, moveTo, typeHuman, smoothScroll, inbound, phone } from "../lib.mjs";

export async function prepare({ page }) {
  await login(page, "carlos");
  await page.goto(`${BASE}/inbox`, { waitUntil: "load" });
  await settle(page, 1500);
  await page.mouse.move(1250, 560);
}

const LIST = "div:has(> button:has-text('Luis Alfonso Kú'))";

export async function run({ page }) {
  await sleep(1200);
  // Recorrido por la lista llena.
  await hover(page, page.locator("button", { hasText: "Arq. Beatriz Solís" }).first());
  await sleep(500);
  const scroller = await page.evaluateHandle(() => {
    const row = [...document.querySelectorAll("button")].find((b) => b.innerText.includes("Arq. Beatriz Solís"));
    let el = row?.parentElement;
    while (el && el.scrollHeight <= el.clientHeight + 5) el = el.parentElement;
    el?.setAttribute("data-rec-list", "1");
    return !!el;
  });
  await smoothScroll(page, "[data-rec-list]", 1400, 2200);
  await sleep(900);
  await smoothScroll(page, "[data-rec-list]", -1400, 1600);
  await settle(page, 900);

  // Filtros: No leídas → Atención humana → Anuncios → etapa → quién atiende.
  const filtro = page.locator("button[aria-label^='Filtrar la bandeja']");
  await clickOn(page, filtro);
  await clickOn(page, page.getByRole("button", { name: /^No leídas/ }), { pause: 1400 });
  await clickOn(page, filtro);
  await clickOn(page, page.getByRole("button", { name: /^Atención humana/ }), { pause: 1400 });
  await clickOn(page, filtro);
  await clickOn(page, page.getByRole("button", { name: /^Anuncios/ }), { pause: 1400 });
  await clickOn(page, filtro);
  await clickOn(page, page.getByRole("button", { name: /^Todas/ }).last(), { pause: 400 });
  await clickOn(page, filtro);
  await hover(page, "select[aria-label='Filtrar por persona asignada']");
  await page.selectOption("select[aria-label='Filtrar por persona asignada']", { label: "Sin asignar" });
  await settle(page, 1500);
  await hover(page, "select[aria-label='Filtrar por persona asignada']");
  await page.selectOption("select[aria-label='Filtrar por persona asignada']", { index: 0 });
  await settle(page, 600);
  await page.keyboard.press("Escape");
  await settle(page, 600);

  // Búsqueda.
  await clickOn(page, "button[aria-label='Buscar conversación (/)']");
  await typeHuman(page, "Ramos", 110);
  await settle(page, 1800);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Backspace");
    await new Promise((r) => setTimeout(r, 70));
  }
  await settle(page, 700);
  await page.keyboard.press("Escape");
  await page.locator("button[aria-label='Buscar conversación (/)']").blur().catch(() => {});
  await moveTo(page, 1250, 560, 700);
  await settle(page, 900);

  // En vivo: llegan mensajes, la fila sube y el globo del menú suma.
  await hover(page, "a[href='/inbox']");
  await sleep(600);
  await moveTo(page, 420, 300, 700);
  await inbound({ from: phone(7), name: "Hugo Sánchez", text: "Va, mándame la cotización con el sellador 👍" });
  await sleep(2200);
  await inbound({ from: phone(26), name: "Teresa Hernández", text: "Sí, apártame el flotador, paso en la tarde" });
  await sleep(2200);
  await inbound({ from: phone(73), name: "Karina Pech", text: "Hola, ¿tienen malla electrosoldada?" });
  await sleep(3200);
  await hover(page, "a[href='/inbox']");
  await sleep(900);

  // Menú angosto: el globo queda como punto.
  await clickOn(page, "button[aria-label='Colapsar el menú']", { pause: 1200 });
  await moveTo(page, 700, 520, 700);
  await inbound({ from: phone(11), name: "Fernando Castillo", text: "¿Ya te confirmaron el precio de las 3 toneladas?" });
  await sleep(2300);
  await hover(page, "a[href='/inbox']");
  await sleep(1200);

  // Menú oculto: la lista sigue viva sin el lateral.
  await clickOn(page, "button[aria-label='Ocultar el menú']", { pause: 1200 });
  await moveTo(page, 820, 520, 700);
  await inbound({ from: phone(17), name: "Alberto Jiménez", text: "También ocupo 20 chalupas y cinta de aislar" });
  await sleep(2300);

  // De vuelta al menú completo: el globo ya suma todo lo que llegó.
  await clickOn(page, "button[aria-label='Mostrar el menú']", { pause: 1200 });
  await hover(page, "a[href='/inbox']");
  await sleep(2200);
}
