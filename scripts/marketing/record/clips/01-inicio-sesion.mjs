/** 01 — Inicio de sesión de Carlos (Propietario) y llegada al panel. */
import { BASE, login, settle, sleep, clickOn, hover, moveTo } from "../lib.mjs";

export async function prepare({ page }) {
  await page.goto(`${BASE}/login`, { waitUntil: "load" });
  await settle(page, 1500);
  await page.mouse.move(1500, 800);
}

export async function run({ page }) {
  await sleep(1500);
  await login(page, "carlos", { visible: true });
  await settle(page, 2000);
  for (const href of ["/inbox", "/chat", "/pipeline", "/contacts", "/campaigns", "/results"]) {
    await hover(page, `a[href='${href}']`, { ms: 450 });
    await sleep(350);
  }
  await clickOn(page, "a[href='/results']", { pause: 2200 });
  await moveTo(page, 1100, 450, 900);
  await sleep(1500);
  await clickOn(page, "a[href='/inbox']", { pause: 2200 });
  await moveTo(page, 1250, 560, 900);
  await sleep(1500);
}
