/** 02 — Bandeja de chats: filtra, busca y recibe mensajes en vivo. */
import { BASE, login, settle, step, mark, chooseOption, clickOn, hover, moveTo, typeText, pressKey, holdUntil, drift, wheelScroll, inbound, phone, sleep } from "../lib.mjs";

export const meta = { title: "Bandeja de chats", subs: "bottom", startPos: { x: 1180, y: 520 } };

export async function prepare({ page }) {
  await login(page, "carlos");
  await page.goto(`${BASE}/inbox`, { waitUntil: "load" });
  await settle(page, 1200);
}

const firstRowIs = (page, name) =>
  page.waitForFunction((nm) => {
    const rows = [...document.querySelectorAll("button")].filter((b) => /\d{2}:\d{2}\s?[ap]\.\s?m\.|\d+ sep/.test(b.innerText));
    return rows[0]?.innerText.includes(nm);
  }, name, { timeout: 15000 });

export async function run({ page }) {
  step("Todos tus chats de WhatsApp en un lugar");
  await hover(page, page.locator("button", { hasText: "Juan Pablo Herrera" }).first(), { dx: 0.4 });
  await wheelScroll(page, 1100, 1800, { cursorTo: { x: 420, y: 760 } });
  await wheelScroll(page, -1100, 1500, { cursorTo: { x: 420, y: 330 } });
  await settle(page, 300);

  step("Filtra los chats sin leer");
  await clickOn(page, "button[aria-label^='Filtrar la bandeja']");
  await clickOn(page, page.getByRole("button", { name: /^No leídas/ }), { after: 700 });
  await hover(page, page.locator("button", { hasText: "Arq. Beatriz Solís" }).first(), { dx: 0.4 });
  await drift(page, { x: 380, y: 30 }, 900);

  step("Vuelve a ver todas las conversaciones");
  await clickOn(page, "button[aria-label^='Filtrar la bandeja']");
  await clickOn(page, page.getByRole("button", { name: /^Todas/ }).last(), { after: 700 });

  step("Filtra por quién atiende cada chat");
  await clickOn(page, "button[aria-label^='Filtrar la bandeja']");
  await chooseOption(page, "select[aria-label='Filtrar por persona asignada']", "Sin asignar");
  await pressKey(page, "Escape", 1, 250);
  await settle(page, 400);
  await hover(page, page.locator("button", { hasText: "Juan Pablo Herrera" }).first(), { dx: 0.4 });
  await drift(page, { x: 380, y: 30 }, 800);
  await clickOn(page, "button[aria-label^='Filtrar la bandeja']");
  await chooseOption(page, "select[aria-label='Filtrar por persona asignada']", "Todo el equipo");
  await pressKey(page, "Escape", 1, 250);
  await settle(page, 500);

  step("Busca un cliente por su nombre");
  await clickOn(page, "button[aria-label='Buscar conversación (/)']", { after: 300 });
  await typeText(page, "Ramos", 85);
  await settle(page, 600);
  await hover(page, page.locator("button", { hasText: "Ing. Alejandro Ramos" }).first(), { dx: 0.4 });
  await drift(page, { x: 420, y: 28 }, 700);
  await moveTo(page, 420, 28, 500);
  await pressKey(page, "Backspace", 5, 90);
  await pressKey(page, "Escape", 1, 150);
  await settle(page, 500);

  step("Llega un mensaje nuevo en vivo");
  await moveTo(page, 430, 250, 700);
  await inbound({ from: phone(7), name: "Hugo Sánchez", text: "Va, mándame la cotización con el sellador 👍" });
  await holdUntil(page, firstRowIs(page, "Hugo Sánchez"), { x: 430, y: 95 });
  await settle(page, 500);
  await hover(page, page.locator("button", { hasText: "Hugo Sánchez" }).first(), { dx: 0.45 });

  step("Un cliente nuevo escribe y el bot responde");
  await moveTo(page, 440, 200, 700);
  await inbound({ from: phone(73), name: "Karina Pech", text: "Hola, ¿tienen malla electrosoldada?" });
  await holdUntil(page, firstRowIs(page, "Karina Pech"), { x: 430, y: 95 });
  await holdUntil(page, page.getByText("Soy Martillito").first().waitFor({ timeout: 15000 }).catch(() => {}), { x: 440, y: 100 });
  await settle(page, 500);

  step("El contador del menú se actualiza solo", { read: true });
  await hover(page, "a[href='/inbox']", { dx: 0.85 });
  await sleep(1500);
}
