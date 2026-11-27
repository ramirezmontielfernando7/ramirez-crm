// Revisión de accesibilidad (axe-core) de las pantallas públicas.
// Solo LEE y reporta: abre cada página con Chromium, corre axe y escribe un
// resumen. Nunca falla el CI (sale 0 salvo que la propia herramienta se rompa).
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { appendFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const axeSource = (await import("node:fs")).readFileSync(
  require.resolve("axe-core/axe.min.js", { paths: [process.env.AXE_DIR ?? "."] }),
  "utf8",
);
const base = process.env.BASE_URL ?? "http://localhost:3000";
const paginas = ["/login", "/register"];

const browser = await chromium.launch();
const lineas = ["## axe-core · accesibilidad (solo informa)", ""];
for (const ruta of paginas) {
  const page = await browser.newPage();
  try {
    await page.goto(base + ruta, { waitUntil: "networkidle" });
    await page.evaluate(axeSource);
    const res = await page.evaluate(() => globalThis.axe.run());
    lineas.push(`### ${ruta}: ${res.violations.length} problemas`);
    for (const v of res.violations) {
      lineas.push(`- **${v.impact}** · ${v.help} (${v.nodes.length} elementos) · \`${v.id}\``);
    }
    lineas.push("");
  } catch (e) {
    lineas.push(`### ${ruta}: no se pudo revisar (${e.message})`, "");
  }
  await page.close();
}
await browser.close();
const out = lineas.join("\n");
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + "\n");
