/** 04 — Ficha del contacto: anuncio de origen, etiquetas, consentimiento, línea de tiempo, pipeline y notas. */
import { BASE, login, settle, sleep, clickOn, hover, moveTo, typeHuman, smoothScroll } from "../lib.mjs";

export async function prepare({ page }) {
  await login(page, "carlos");
  await page.goto(`${BASE}/inbox`, { waitUntil: "load" });
  await settle(page, 1500);
  await page.mouse.move(1250, 560);
}

async function markPanel(page) {
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].find((e) => e.textContent?.trim() === "DETALLES" || e.textContent?.trim() === "Detalles");
    let el = h?.parentElement;
    while (el && !(el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY !== "visible")) el = el.parentElement;
    if (!el) el = [...document.querySelectorAll("aside, div")].filter((e) => e.getBoundingClientRect().left > 1500 && e.scrollHeight > e.clientHeight + 40).pop();
    el?.setAttribute("data-rec-panel", "1");
  });
}

export async function run({ page }) {
  await sleep(900);
  await clickOn(page, page.locator("button", { hasText: "Arq. Beatriz Solís" }).first(), { pause: 1500 });
  await markPanel(page);
  // Ficha y anuncio de origen.
  await hover(page, page.getByText("Llegó por un anuncio").first(), { ms: 900 });
  await sleep(1200);
  await hover(page, "select[aria-label='Asignar a']");
  await sleep(700);
  // Pipeline: la arquitecta cerró → Cliente.
  await hover(page, "[aria-label='Mover a Interesado']");
  await sleep(500);
  await clickOn(page, "[aria-label='Mover a Cliente']", { pause: 1500 });
  // Más detalles: consentimiento y etiquetas.
  await clickOn(page, page.getByText("MÁS DETALLES").first(), { pause: 900 });
  await smoothScroll(page, "[data-rec-panel]", 420, 1100);
  await settle(page, 700);
  await hover(page, page.getByText("Acepta mensajes").last(), { ms: 800 });
  await sleep(700);
  const addTag = page.locator("select[aria-label='Agregar etiqueta']");
  await hover(page, addTag);
  await addTag.selectOption({ label: "Cliente frecuente" });
  await settle(page, 1500); // elegir la etiqueta ya la agrega
  // Nota interna y línea de tiempo.
  await smoothScroll(page, "[data-rec-panel]", 520, 1100);
  await settle(page, 600);
  await clickOn(page, "textarea[aria-label='Nueva nota']", { pause: 300 });
  await typeHuman(page, "Cerró el pedido completo. Entrega en zona hotelera el viernes a las 9 am.", 32);
  await clickOn(page, page.getByRole("button", { name: "Añadir nota" }), { pause: 1500 });
  await smoothScroll(page, "[data-rec-panel]", 400, 1100);
  await settle(page, 900);
  await hover(page, page.getByText("Etapa cambiada a Cliente").first(), { ms: 800 }).catch(() => {});
  await sleep(1400);
  await hover(page, page.getByText("Etiqueta «Cliente frecuente»").first(), { ms: 700 }).catch(() => {});
  await sleep(1400);
  await moveTo(page, 1100, 600, 900);
  await sleep(800);
}
