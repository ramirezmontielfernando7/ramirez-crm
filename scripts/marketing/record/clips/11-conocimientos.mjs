/** 11 — Conocimientos del equipo y envío desde la Bandeja con "/". */
import { BASE, login, settle, sleep, clickOn, hover, moveTo, typeHuman } from "../lib.mjs";

export async function prepare({ page }) {
  await login(page, "carlos");
  await page.goto(`${BASE}/knowledge`, { waitUntil: "load" });
  await settle(page, 1500);
  await page.mouse.move(1250, 560);
}

export async function run({ page }) {
  await sleep(900);
  for (const t of ["Zona de entrega", "Formas de pago", "Catálogo principal", "Política de devoluciones", "Horarios de atención"]) {
    await hover(page, page.getByText(t, { exact: true }).first(), { ms: 600 });
    await sleep(700);
  }
  await hover(page, page.getByText("catalogo-el-martillo.pdf").first(), { ms: 600 });
  await sleep(900);
  await clickOn(page, "input[aria-label='Buscar en Conocimientos']", { pause: 200 });
  await typeHuman(page, "entrega", 90);
  await settle(page, 1400);
  // En la Bandeja: "/" abre Conocimientos dentro del editor.
  await clickOn(page, "a[href='/inbox']", { pause: 1400 });
  await clickOn(page, page.locator("button", { hasText: "Patricia Vázquez" }).first(), { pause: 1400 });
  await clickOn(page, page.getByPlaceholder("Escribe una respuesta…"), { pause: 300 });
  await page.keyboard.type("/");
  await settle(page, 1000);
  await typeHuman(page, "zona", 120);
  await settle(page, 1200);
  await clickOn(page, page.getByRole("button", { name: "Enviar texto" }).first(), { pause: 2400 });
  // Y el catálogo en PDF desde el botón de Conocimientos.
  await clickOn(page, "button[aria-label='Conocimientos']", { pause: 800 });
  await typeHuman(page, "catálogo", 90);
  await settle(page, 1200);
  await clickOn(page, page.getByRole("button", { name: /Enviar/ }).first(), { pause: 2600 });
  await moveTo(page, 1100, 500, 800);
  await sleep(1200);
}
