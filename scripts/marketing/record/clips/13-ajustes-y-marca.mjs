/**
 * 13 — Ajustes: equipo y roles, chat de equipo (interruptores y grupos) y
 * marca. Se entra directo a Equipo: la página raíz de Ajustes (WhatsApp)
 * muestra la URL del webhook con su token y NO debe salir en cámara.
 */
import { BASE, login, settle, sleep, clickOn, hover, moveTo } from "../lib.mjs";

export async function prepare({ page }) {
  await login(page, "carlos");
  await page.goto(`${BASE}/settings/team`, { waitUntil: "load" });
  await settle(page, 1800);
  await page.mouse.move(1250, 560);
}

export async function run({ page }) {
  await sleep(900);
  for (const n of ["Sofía Ramírez", "Diego López", "Lucía Ortega"]) {
    await hover(page, `select[aria-label='Rol de ${n}']`, { ms: 600 });
    await sleep(700);
  }
  const rol = page.locator("select[aria-label='Rol de Iván Salazar']");
  await hover(page, rol);
  await rol.selectOption({ label: "Coordinador" });
  await settle(page, 1500);
  await rol.selectOption({ label: "Asesor" });
  await settle(page, 1200);
  // Chat de equipo.
  await clickOn(page, "a[href='/settings/team-chat']", { pause: 1400 });
  await clickOn(page, "button[aria-label='Avisar al equipo que hay supervisión']", { pause: 1200 });
  await clickOn(page, "button[aria-label='Los Coordinadores pueden crear grupos']", { pause: 1200 });
  for (const g of ["Coordinación", "Equipo de ventas", "Postventa"]) {
    await hover(page, page.getByText(g, { exact: true }).first(), { ms: 550 });
    await sleep(600);
  }
  // Marca: Dashfort by Demfort, acentos y tono del lateral.
  await clickOn(page, "a[href='/settings/branding']", { pause: 1500 });
  await clickOn(page, "button[aria-label='Azul eléctrico']", { pause: 1300 });
  await clickOn(page, page.getByRole("button", { name: "Teal noche" }), { pause: 1300 });
  await clickOn(page, "button[aria-label='Teal Dashfort']", { pause: 1100 });
  await clickOn(page, page.getByRole("button", { name: /Teal profundo/ }), { pause: 1300 });
  await hover(page, page.getByRole("button", { name: "Guardar marca" }), { ms: 700 });
  await sleep(900);
  await moveTo(page, 110, 30, 900);
  await sleep(1400);
}
