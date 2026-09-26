/** 06 — Roles: Propietario ve todo; Diego (Asesor) solo lo suyo; Sofía (Coordinadora) todo el equipo; vuelve Carlos. */
import { BASE, login, settle, sleep, clickOn, hover, moveTo } from "../lib.mjs";

export async function prepare({ page }) {
  await login(page, "carlos");
  await page.goto(`${BASE}/inbox`, { waitUntil: "load" });
  await settle(page, 1500);
  await page.mouse.move(1250, 560);
}

async function logout(page) {
  let btn = page.locator("button[aria-label='Cerrar sesión']:visible").first();
  if (!(await btn.count())) {
    // Menú angosto: la salida vive en el menú del perfil.
    await clickOn(page, page.locator("button[aria-label*=' · ']:visible").last(), { pause: 700 });
    btn = page.locator("button[aria-label='Cerrar sesión']:visible").first();
  }
  await clickOn(page, btn, { pause: 600 });
  await page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 15000 });
  await settle(page, 900);
}

async function showList(page) {
  await hover(page, "button[aria-label^='Filtrar la bandeja']", { ms: 700 });
  await sleep(1300);
  await moveTo(page, 420, 500, 700);
  await sleep(900);
}

export async function run({ page }) {
  await sleep(900);
  await showList(page);                       // Propietario: los 32 chats
  await hover(page, "a[href='/settings']", { ms: 700 });
  await sleep(700);
  await logout(page);
  await login(page, "diego", { visible: true }); // Asesor
  await settle(page, 1800);
  await showList(page);
  await clickOn(page, page.locator("button", { hasText: "Ing. Alejandro Ramos" }).first(), { pause: 1600 });
  await moveTo(page, 1100, 500, 800);
  await sleep(900);
  await logout(page);
  await login(page, "sofia", { visible: true }); // Coordinadora
  await settle(page, 1800);
  await showList(page);
  await clickOn(page, "button[aria-label^='Filtrar la bandeja']");
  const quien = page.locator("select[aria-label='Filtrar por persona asignada']");
  await hover(page, quien);
  await quien.selectOption({ label: "Diego López" });
  await settle(page, 1400);
  await page.keyboard.press("Escape");
  await settle(page, 1000);
  await logout(page);
  await login(page, "carlos", { visible: true });
  await settle(page, 1800);
  await showList(page);
}
