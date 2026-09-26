/**
 * Graba clips (reglas v2): node scripts/marketing/record/run.mjs 02 03 10
 * Por clip: reinicia la instancia (BD + siembra) ANTES de grabar, prepara la
 * pantalla fuera de cámara, graba el maestro sin pérdida y, ya con la
 * grabación cerrada, hace la posproducción y la revisión automática.
 *   --no-reset   reusar el estado actual
 *   --no-post    solo maestro
 */
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { launch, newContext, Recorder, fpsMeterStart, fpsMeterStop, fullscreen, trackNetwork, TL, ROOT, sleep } from "./lib.mjs";
import { post } from "./post.mjs";

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
  trackNetwork(page);
  await fullscreen(page);
  const env = { browser, ctx, page };
  await clip.prepare?.(env);
  TL.pos = clip.meta?.startPos ?? { x: 1250, y: 560 };
  await page.mouse.move(TL.pos.x, TL.pos.y);
  // Chromium muestra ~5 s el aviso "Para salir de pantalla completa…": que
  // desaparezca antes de grabar, y todo quieto y estable.
  await sleep(Math.max(1200, 7000 - (Date.now() - (page.__fullscreenAt ?? 0))));
  const rec = new Recorder(name);
  rec.startPos = { ...TL.pos };
  await fpsMeterStart(env.page).catch(() => {});
  await rec.start(env.page);
  let failed = null;
  try {
    await clip.run(env);
  } catch (e) {
    failed = e;
  }
  const fps = await fpsMeterStop(env.page).catch(() => null);
  await rec.stop();
  console.log("[fps navegador]", JSON.stringify(fps));
  await clip.cleanup?.(env).catch(() => {});
  await browser.close();
  if (failed) throw failed;
  if (!flags.has("--no-post")) await post(name, clip.meta ?? {});
}
