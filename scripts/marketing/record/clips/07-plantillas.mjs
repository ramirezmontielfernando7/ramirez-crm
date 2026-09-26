/** 07 — Plantillas: estados en Ajustes y envío de una plantilla aprobada desde un chat con la ventana cerrada. */
import { BASE, login, settle, sleep, clickOn, hover, moveTo, typeHuman } from "../lib.mjs";

export async function prepare({ page }) {
  await login(page, "carlos");
  await page.goto(`${BASE}/settings/templates`, { waitUntil: "load" });
  await settle(page, 1800);
  await page.mouse.move(1500, 560);
}

export async function run({ page }) {
  await sleep(900);
  for (const n of ["bienvenida", "promocion", "recordatorio_entrega", "oferta_relampago"]) {
    await hover(page, page.getByText(n, { exact: true }).first(), { ms: 650 });
    await sleep(900);
  }
  await hover(page, page.getByText("Pendiente de Meta").first(), { ms: 600 });
  await sleep(700);
  await hover(page, page.getByText("Rechazada").first(), { ms: 600 });
  await sleep(1000);
  // En un chat con la ventana de 24 h cerrada, solo se puede mandar plantilla.
  await clickOn(page, "a[href='/inbox']", { pause: 1500 });
  await clickOn(page, page.locator("button", { hasText: "Norma Canché" }).first(), { pause: 1500 });
  await hover(page, page.getByText("La ventana de 24 horas está cerrada.").first(), { ms: 700 });
  await sleep(1000);
  const sel = page.locator("#template-select");
  await hover(page, sel);
  await sel.selectOption({ label: "promocion (es_MX)" });
  await settle(page, 1200);
  await clickOn(page, "#template-variable-1", { pause: 200 });
  await typeHuman(page, "Norma", 70);
  await clickOn(page, "#template-variable-2", { pause: 200 });
  await typeHuman(page, "el impermeabilizante acrílico 5 años", 40);
  await sleep(500);
  await clickOn(page, page.getByRole("button", { name: "Enviar plantilla" }), { pause: 2400 });
  await moveTo(page, 1100, 500, 800);
  await sleep(1500);
}
