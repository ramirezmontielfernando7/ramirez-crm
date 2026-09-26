/** 12 — Resultados: ventas, agente, origen y anuncios, higiene; periodos y filtro por persona. */
import { BASE, login, settle, sleep, clickOn, hover, moveTo } from "../lib.mjs";

export async function prepare({ page }) {
  await login(page, "carlos");
  await page.goto(`${BASE}/results`, { waitUntil: "load" });
  await settle(page, 2000);
  await page.mouse.move(1250, 560);
  await page.evaluate(() => {
    const els = [...document.querySelectorAll("main, main *, div")].filter((e) => e.scrollHeight > e.clientHeight + 200 && getComputedStyle(e).overflowY !== "visible");
    els[0]?.setAttribute("data-rec-main", "1");
  });
}

async function scroll(page, dy, ms = 1800) {
  await page.evaluate(async ({ dy, ms }) => {
    const el = document.querySelector("[data-rec-main]") ?? document.scrollingElement;
    const s = el.scrollTop, t0 = performance.now();
    await new Promise((r) => { const f = (n) => { const t = Math.min(1, (n - t0) / ms); const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; el.scrollTop = s + dy * e; t < 1 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); });
  }, { dy, ms });
}

export async function run({ page }) {
  await sleep(900);
  await hover(page, page.getByText("Dinero ganado").first(), { ms: 700 });
  await sleep(1200);
  await hover(page, page.getByText("Tratos ganados").nth(1), { ms: 700 }).catch(() => {});
  await sleep(1200);
  for (const p of ["7 días", "Este mes", "90 días", "30 días"]) {
    await clickOn(page, page.getByRole("button", { name: p, exact: true }), { pause: 1500 });
  }
  const who = page.locator("select[aria-label='Resultados de']");
  await hover(page, who);
  await who.selectOption({ label: "Diego López" });
  await settle(page, 1800);
  await who.selectOption({ index: 0 });
  await settle(page, 1200);
  await moveTo(page, 1100, 600, 800);
  for (let i = 0; i < 5; i++) {
    await scroll(page, 760, 1700);
    await settle(page, 1300);
  }
  await scroll(page, -3800, 2600);
  await settle(page, 1200);
}
