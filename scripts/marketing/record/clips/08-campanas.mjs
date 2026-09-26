/** 08 — Campañas (CAMPAIGNS=on): plantilla aprobada, público por etiqueta con opt_in, resumen, envío y resultados. */
import { BASE, login, settle, sleep, clickOn, hover, moveTo, typeHuman, smoothScroll } from "../lib.mjs";

export async function prepare({ page }) {
  await login(page, "carlos");
  await page.goto(`${BASE}/campaigns`, { waitUntil: "load" });
  await settle(page, 1500);
  await page.mouse.move(1250, 560);
}

export async function run({ page }) {
  await sleep(900);
  await clickOn(page, page.getByText("Nueva campaña").first(), { pause: 1400 });
  await clickOn(page, page.getByPlaceholder("Ej.: Promo 2x1 marzo — clientes VIP"), { pause: 200 });
  await typeHuman(page, "Promo impermeabilizante — clientes frecuentes", 30);
  const tpl = page.locator("select").first();
  await hover(page, tpl);
  await tpl.selectOption({ label: "promocion (es_MX, MARKETING)" });
  await settle(page, 1200);
  await clickOn(page, page.getByRole("button", { name: "Cliente frecuente" }), { pause: 800 });
  await clickOn(page, page.getByRole("button", { name: "Mayoreo" }), { pause: 1000 });
  await hover(page, page.getByText("Le llegará a").first(), { ms: 700 });
  await sleep(1200);
  const v1 = page.locator("select[aria-label='Tipo de {{1}}']");
  await hover(page, v1);
  await v1.selectOption({ label: "Nombre del contacto" });
  await settle(page, 600);
  await clickOn(page, "input[aria-label='Valor de {{2}}']", { pause: 200 });
  await typeHuman(page, "el impermeabilizante acrílico 5 años", 35);
  await clickOn(page, page.getByRole("button", { name: "Revisar envío" }), { pause: 1400 });
  await smoothScroll(page, "main", 600, 1200).catch(() => {});
  await page.mouse.wheel(0, 600);
  await settle(page, 1200);
  await hover(page, page.getByText("Así lo verá").first(), { ms: 700 }).catch(() => {});
  await sleep(1400);
  await clickOn(page, page.getByRole("button", { name: /Confirmar y enviar/ }), { pause: 1500 });
  // Detalle con el avance y los resultados por destinatario.
  await moveTo(page, 1100, 500, 800);
  await sleep(6500);
  await page.mouse.wheel(0, 500);
  await settle(page, 1500);
  await moveTo(page, 900, 700, 800);
  await sleep(2500);
}
