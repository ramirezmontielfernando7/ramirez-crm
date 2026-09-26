/** 05 — Asignar y reasignar chats, asignación en lote y bitácora de asignación. */
import { BASE, login, settle, sleep, clickOn, hover, moveTo } from "../lib.mjs";

export async function prepare({ page }) {
  await login(page, "carlos");
  await page.goto(`${BASE}/inbox`, { waitUntil: "load" });
  await settle(page, 1500);
  await page.mouse.move(1250, 560);
}

export async function run({ page }) {
  await sleep(900);
  // Un chat sin asignar → Paola; luego se reasigna a Iván.
  await clickOn(page, page.locator("button", { hasText: "Juan Pablo Herrera" }).first(), { pause: 1400 });
  const asignar = page.locator("select[aria-label='Asignar a']");
  await hover(page, asignar);
  await sleep(500);
  await asignar.selectOption({ label: "Paola Núñez" });
  await settle(page, 1800);
  await hover(page, asignar);
  await sleep(500);
  await asignar.selectOption({ label: "Iván Salazar" });
  await settle(page, 1800);
  // Bitácora de asignación.
  await clickOn(page, page.getByText("Ver historial de asignación").first(), { pause: 2400 });
  await moveTo(page, 1100, 600, 800);
  await sleep(900);
  // En lote: varios chats sin asignar → Andrea.
  await clickOn(page, "button[aria-label='Seleccionar varios']", { pause: 900 });
  for (const n of ["Guadalupe Chan", "Ricardo Pérez", "Javier Cruz Pat"]) {
    await clickOn(page, page.locator("button", { hasText: n }).first(), { pause: 500, dx: 0.06 });
  }
  const lote = page.locator("select[aria-label='Asignar seleccionados a']");
  await hover(page, lote);
  await sleep(500);
  await lote.selectOption({ label: "Andrea Vega" }).catch(async () => {
    const opts = await lote.locator("option").allTextContents();
    await lote.selectOption({ label: opts.find((o) => o.includes("Andrea")) });
  });
  await settle(page, 1200);
  const confirmar = page.getByRole("button", { name: /Asignar|Reasignar|Confirmar/ }).last();
  if (await confirmar.isVisible().catch(() => false)) await clickOn(page, confirmar, { pause: 1800 });
  await settle(page, 1500);
  await moveTo(page, 1250, 560, 900);
  await sleep(700);
  // Filtro "Quién atiende": los de Andrea.
  await clickOn(page, "button[aria-label^='Filtrar la bandeja']");
  const quien = page.locator("select[aria-label='Filtrar por persona asignada']");
  await hover(page, quien);
  await quien.selectOption({ label: "Andrea Vega" });
  await settle(page, 1200);
  await page.keyboard.press("Escape");
  await settle(page, 1800);
}
