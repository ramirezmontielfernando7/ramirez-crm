/** 09 — Importar un CSV de 12 contactos (etiqueta de origen automática) y exportar con filtros. */
import path from "node:path";
import { BASE, OUT, login, settle, sleep, clickOn, hover, moveTo } from "../lib.mjs";

export async function prepare({ page }) {
  await login(page, "carlos");
  await page.goto(`${BASE}/contacts`, { waitUntil: "load" });
  await settle(page, 1500);
  await page.mouse.move(1250, 560);
}

export async function run({ page }) {
  await sleep(900);
  await clickOn(page, page.getByRole("button", { name: "Importar" }), { pause: 1200 });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    clickOn(page, "input[type=file]", { pause: 200, dx: 0.1 }),
  ]);
  await chooser.setFiles(path.join(OUT, ".assets/clientes-septiembre.csv"));
  await settle(page, 1200);
  await hover(page, page.getByPlaceholder("Import: clientes-septiembre.csv"), { ms: 700 }).catch(() => {});
  await sleep(1200);
  await clickOn(page, page.getByRole("button", { name: "Importar", exact: true }).last(), { pause: 2800 });
  await moveTo(page, 960, 520, 800);
  await sleep(2200);
  const cerrar = page.getByRole("button", { name: /Cerrar|Listo|Ver contactos/ }).last();
  if (await cerrar.isVisible().catch(() => false)) await clickOn(page, cerrar, { pause: 1200 });
  // Filtrar por la etiqueta de origen: los 12 recién importados + la base anterior.
  const tag = page.locator("select[aria-label='Filtrar por etiqueta']");
  await hover(page, tag);
  await tag.selectOption({ label: "Import: clientes-septiembre.csv" });
  await settle(page, 1800);
  const cons = page.locator("select[aria-label='Filtrar por consentimiento']");
  await hover(page, cons);
  await cons.selectOption({ label: "Acepta mensajes" });
  await settle(page, 1800);
  await moveTo(page, 900, 600, 800);
  await sleep(900);
  // Exportar respeta los filtros.
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }).catch(() => null),
    clickOn(page, page.getByText("Exportar").first(), { pause: 1500 }),
  ]);
  if (dl) await dl.saveAs(path.join(OUT, "logs", "export-filtrado.csv")).catch(() => {});
  await sleep(1500);
}
