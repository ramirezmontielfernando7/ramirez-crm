/**
 * Graba clips: node scripts/marketing/record/run.mjs 02 03 10
 * Por clip: reinicia la instancia (BD + siembra frescas), abre Chromium en el
 * Xvfb, prepara la pantalla fuera de cámara, graba el maestro sin pérdida y
 * exporta el MP4 final con fades.
 *   --no-reset   reusar el estado actual
 *   --no-export  solo maestro
 */
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { launch, newContext, Recorder, fpsMeterStart, fpsMeterStop, fullscreen, ROOT } from "./lib.mjs";
import { exportClip } from "./export.mjs";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const wanted = args.filter((a) => !a.startsWith("--"));
const dir = path.join(ROOT, "scripts/marketing/record/clips");
const files = readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort();

for (const w of wanted) {
  const file = files.find((f) => f.startsWith(w));
  if (!file) throw new Error("clip no encontrado: " + w);
  const name = file.replace(/\.mjs$/, "");
  const clip = await import(path.join(dir, file));
  console.log(`\n=== ${name} ===`);
  if (!flags.has("--no-reset")) {
    execSync("./scripts/marketing/reset.sh > /tmp/vocero-marketing/reset.log 2>&1", { cwd: ROOT, stdio: "inherit" });
  }
  const browser = await launch();
  const ctx = await newContext(browser);
  const page = await ctx.newPage();
  await fullscreen(page);
  const env = { browser, ctx, page };
  await clip.prepare?.(env);
  const rec = new Recorder(name);
  await fpsMeterStart(page).catch(() => {});
  await rec.start();
  try {
    await clip.run(env);
  } finally {
    const fps = await fpsMeterStop(env.page).catch(() => null);
    const stats = await rec.stop();
    console.log("[fps navegador]", JSON.stringify(fps));
    await clip.cleanup?.(env).catch(() => {});
    await browser.close();
    if (!flags.has("--no-export")) await exportClip(name, stats, fps);
  }
}
