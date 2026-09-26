/**
 * Grabación de piezas de marketing (reglas v2).
 *
 * - Xvfb + matchbox + Chromium headed en pantalla completa; Playwright solo
 *   navega y manda eventos; ffmpeg x11grab graba el maestro sin pérdida.
 * - El CURSOR no vive en la página: el grabador registra su trayectoria
 *   (segmentos con aceleración y frenado) y se dibuja en posproducción a 60
 *   fps exactos, encima de todo (también de los menús nativos y diálogos).
 * - Todo cambio en pantalla lo provoca una acción visible: clic con el mouse,
 *   tecleo con ritmo humano, clic real de X (xdotool) en popups nativos.
 * - Los pasos del guion (subtítulos) y los eventos quedan en una línea de
 *   tiempo con el reloj del grabador; un marcador de color de un cuadro al
 *   inicio sincroniza ese reloj con el video.
 */
import { spawn, execSync, execFileSync } from "node:child_process";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
export const BASE = process.env.APP_URL ?? "http://localhost:3000";
export const MOCK = process.env.MOCK_URL ?? "http://127.0.0.1:4010";
export const PASSWORD = process.env.DEMO_PASSWORD ?? "Martillo-Demo-2026";
export const CHROME = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
export const DISPLAY = process.env.REC_DISPLAY ?? ":99";
export const FPS = Number(process.env.REC_FPS ?? 60);
export const OUT = path.join(ROOT, "marketing");
export const MASTERS = path.join(OUT, "masters");
export const SEED = () => JSON.parse(readFileSync(path.join(OUT, ".seed-ids.json"), "utf8"));
for (const d of [OUT, MASTERS, path.join(OUT, "logs"), path.join(OUT, "revision"), path.join(OUT, "subtitulos"),
  path.join(OUT, "videos/con-subtitulos"), path.join(OUT, "videos/sin-subtitulos")]) mkdirSync(d, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
export const EMAIL = {
  carlos: "carlos@elmartillo.demo", sofia: "sofia@elmartillo.demo", marcela: "marcela@elmartillo.demo",
  diego: "diego@elmartillo.demo", paola: "paola@elmartillo.demo", ivan: "ivan@elmartillo.demo",
  andrea: "andrea@elmartillo.demo", hector: "hector@elmartillo.demo", lucia: "lucia@elmartillo.demo",
};
const XENV = { ...process.env, DISPLAY, LANG: "es_MX.UTF-8", LANGUAGE: "es_MX:es", LC_ALL: "es_MX.UTF-8" };

/* ---------------- Xvfb + gestor de ventanas ---------------- */
function ensureWm() {
  try {
    execSync("pidof matchbox-window-manager > /dev/null");
  } catch {
    const wm = spawn("matchbox-window-manager", ["-use_titlebar", "no", "-use_cursor", "no"], { detached: true, stdio: "ignore", env: XENV });
    wm.unref();
    execSync("sleep 0.5");
  }
}
export function ensureXvfb() {
  const up = () => { try { execSync(`xdpyinfo -display ${DISPLAY} > /dev/null 2>&1`); return true; } catch { return false; } };
  if (!up()) {
    spawn("Xvfb", [DISPLAY, "-screen", "0", "1920x1080x24", "-nolisten", "tcp", "-ac"], { detached: true, stdio: "ignore" }).unref();
    for (let i = 0; i < 50 && !up(); i++) execSync("sleep 0.1");
    if (!up()) throw new Error("Xvfb no arrancó");
  }
  ensureWm();
}

/** Zona horaria "Etc/GMT±N" para que la hora local del video sea de día (~11:00). */
export function daytimeZone() {
  if (process.env.REC_TZ) return process.env.REC_TZ;
  let off = 11 - new Date().getUTCHours();
  if (off > 12) off -= 24;
  if (off < -12) off += 24;
  return off === 0 ? "Etc/GMT" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
}

/* ---------------- Navegador ---------------- */
export async function launch({ headed = true } = {}) {
  if (headed) ensureXvfb();
  return chromium.launch({
    headless: !headed,
    executablePath: CHROME,
    env: XENV,
    ignoreDefaultArgs: ["--enable-automation"],
    args: headed
      ? [
          "--window-position=0,0", "--window-size=1920,1080",
          // Medido en este equipo (sin GPU): con SwiftShader una animación a
          // pantalla completa cae a ~23 fps; el compositor por software
          // (--disable-gpu) sostiene 60. REC_GL=swiftshader para comparar.
          ...(process.env.REC_GL === "swiftshader"
            ? ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-vsync=false"]
            : ["--disable-gpu"]),
          "--hide-scrollbars", "--disable-infobars", "--noerrdialogs",
          "--disable-features=Translate,MediaRouter", "--disable-background-networking",
          "--disable-component-update", "--no-first-run", "--lang=es-MX",
        ]
      : ["--disable-background-networking", "--lang=es-MX"],
  });
}

export async function newContext(browser, { ip = "10.60.0." + Math.floor(rnd(20, 220)), dsf = 1, theme = "light", headedWindow = true } = {}) {
  return browser.newContext({
    ...(headedWindow && dsf === 1 ? { viewport: null } : { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dsf }),
    locale: "es-MX",
    timezoneId: daytimeZone(),
    colorScheme: theme,
    extraHTTPHeaders: { "x-forwarded-for": ip },
    reducedMotion: "no-preference",
  });
}

/** Pantalla completa real 1920x1080 (sin pestañas ni barra de URL). */
export async function fullscreen(page) {
  const cdp = await page.context().newCDPSession(page);
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "fullscreen" } });
  await sleep(600);
  page.__fullscreenAt = Date.now();
  const vp = await page.evaluate(() => [innerWidth, innerHeight]);
  if (vp[0] !== 1920 || vp[1] !== 1080) throw new Error("pantalla completa fallida: " + vp);
}

/* ---------------- Red en reposo ---------------- */
const inflight = new WeakMap();
/** Cuenta peticiones en curso (sin el canal SSE, que vive abierto). */
export function trackNetwork(page) {
  const set = new Set();
  inflight.set(page, set);
  const ignore = (r) => r.url().includes("/api/events") || r.url().startsWith("data:");
  page.on("request", (r) => { if (!ignore(r)) set.add(r); });
  page.on("requestfinished", (r) => set.delete(r));
  page.on("requestfailed", (r) => set.delete(r));
}

/**
 * La UI terminó de reaccionar: sin animaciones en curso y sin peticiones en
 * vuelo. `min` es el tiempo mínimo para que el ojo vea el cambio.
 */
export async function settle(page, min = 500, max = 5000) {
  const t0 = Date.now();
  const set = inflight.get(page);
  while (Date.now() - t0 < max) {
    const anim = await page
      .evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming?.().iterations !== Infinity).length)
      .catch(() => 0);
    if (anim === 0 && (!set || set.size === 0)) break;
    await sleep(40);
  }
  const left = min - (Date.now() - t0);
  if (left > 0) await sleep(left);
}

/* ---------------- Línea de tiempo (cursor, pasos, eventos) ---------------- */
export const TL = { on: false, cursor: [], clicks: [], steps: [], events: [], typing: [], pos: { x: 1250, y: 560 }, lastActive: 0, idle: [] };
function active(label) {
  const now = Date.now();
  if (TL.on && TL.lastActive && now - TL.lastActive > 1200) TL.idle.push({ at: now, ms: now - TL.lastActive, before: label });
  TL.lastActive = now;
}
/** Evento del guion (llega un mensaje, cambia de pantalla…): transición prevista. */
export function mark(label) {
  TL.events.push({ t: Date.now(), label });
}

/**
 * Subtítulo del paso que empieza: aparece 0.4 s antes de la acción y dura
 * hasta que empieza el siguiente paso (o `endStep`). Máx. 8 palabras.
 * `read` = pausa de lectura deliberada (permitida hasta 2 s).
 */
export function step(text, { read = false } = {}) {
  if (text.trim().split(/\s+/).length > 8) throw new Error("subtítulo de más de 8 palabras: " + text);
  const now = Date.now();
  const prev = TL.steps.at(-1);
  if (prev && prev.end == null) prev.end = now - 450;
  TL.steps.push({ start: now - 400, end: null, text, read });
}
export function endStep() {
  const prev = TL.steps.at(-1);
  if (prev && prev.end == null) prev.end = Date.now();
}

/* ---------------- Cursor ---------------- */
/**
 * Mueve el cursor en trayectoria suave (curva leve, aceleración y frenado).
 * El trazo se dibuja en posproducción a 60 fps (≥ 25 cuadros en 500 ms); el
 * evento real del mouse llega al final, sobre el elemento.
 */
export async function moveTo(page, x, y, ms) {
  const from = { ...TL.pos };
  const dist = Math.hypot(x - from.x, y - from.y);
  const dur = Math.round(ms ?? Math.min(800, Math.max(500, 380 + dist * 0.3)));
  const bend = (Math.random() < 0.5 ? -1 : 1) * Math.min(60, dist * 0.08);
  active("mover");
  const t = Date.now();
  TL.cursor.push({ a: t, b: t + dur, from, to: { x, y }, bend });
  TL.pos = { x, y };
  TL.lastActive = t + dur; // el trayecto entero es movimiento
  await sleep(dur);
  if (page) await page.mouse.move(x, y).catch(() => {});
  active("mover");
}

async function boxOf(page, target) {
  const loc = typeof target === "string" ? page.locator(target).first() : target;
  await loc.waitFor({ state: "visible", timeout: 15000 });
  const bb = await loc.boundingBox();
  if (!bb) throw new Error("sin caja: " + target);
  return { loc, bb };
}

export async function hover(page, target, { dx = 0.5, dy = 0.5, ms } = {}) {
  const { bb } = await boxOf(page, target);
  await moveTo(page, bb.x + bb.width * dx, bb.y + bb.height * dy, ms);
}

/** Clic humano: trayecto de 500-800 ms, pausa 150-250 ms, down/up. */
export async function clickOn(page, target, { dx = 0.5, dy = 0.5, ms, after = 500, dbl = false } = {}) {
  const { bb } = await boxOf(page, target);
  const x = bb.x + bb.width * dx, y = bb.y + bb.height * dy;
  await moveTo(page, x, y, ms);
  await sleep(rnd(150, 250));
  TL.clicks.push({ t: Date.now(), x, y });
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
  if (dbl) {
    await sleep(90);
    TL.clicks.push({ t: Date.now(), x, y });
    await page.mouse.down(); await sleep(50); await page.mouse.up();
  }
  active("clic");
  await settle(page, after);
}

/** Deja el puntero real de X en una esquina neutra (no se dibuja en el video). */
export function parkXPointer() {
  execFileSync("xdotool", ["mousemove", "1919", "1079"], { env: XENV });
}

/** Clic REAL de X en coordenadas de pantalla (popups nativos, diálogos). */
export async function xClick(x, y, { ms, dbl = false } = {}) {
  // El puntero real de X acompaña al cursor dibujado: los menús nativos
  // resaltan la opción bajo el puntero, igual que con una persona.
  const glide = moveTo(null, x, y, ms);
  const seg = TL.cursor.at(-1);
  const follow = (async () => {
    while (Date.now() < seg.b) {
      const u = Math.min(1, (Date.now() - seg.a) / (seg.b - seg.a));
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const dx = seg.to.x - seg.from.x, dy = seg.to.y - seg.from.y, len = Math.hypot(dx, dy) || 1;
      const arc = 4 * e * (1 - e) * seg.bend;
      const px = seg.from.x + dx * e + (-dy / len) * arc, py = seg.from.y + dy * e + (dx / len) * arc;
      if (u > 0.55) execFileSync("xdotool", ["mousemove", String(Math.round(px)), String(Math.round(py))], { env: XENV });
      await sleep(40);
    }
  })();
  await Promise.all([glide, follow]);
  execFileSync("xdotool", ["mousemove", String(Math.round(x)), String(Math.round(y))], { env: XENV });
  await sleep(rnd(150, 250));
  TL.clicks.push({ t: Date.now(), x, y });
  execFileSync("xdotool", dbl ? ["click", "--repeat", "2", "--delay", "90", "1"] : ["click", "1"], { env: XENV });
  if (dbl) TL.clicks.push({ t: Date.now() + 90, x, y });
  active("clic");
  await sleep(120);
  parkXPointer();
}

/** Tecleo con ritmo humano (60-90 ms por tecla). */
export async function typeText(page, text, delay = 75) {
  active("teclear");
  const seg = { a: Date.now(), b: null };
  TL.typing.push(seg);
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 0 });
    await sleep(rnd(delay - 12, delay + 12));
    active("teclear");
  }
  seg.b = Date.now();
}

/** "Lee" un elemento: el cursor lo recorre despacio de izquierda a derecha. */
export async function readAlong(page, target, ms = 1200) {
  const { bb } = await boxOf(page, target);
  await moveTo(page, bb.x + Math.min(40, bb.width * 0.15), bb.y + bb.height * 0.6, 550);
  await moveTo(page, bb.x + bb.width * 0.85, bb.y + bb.height * 0.6, ms);
}
export async function pressKey(page, key, times = 1, delay = 110) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    active("tecla");
    await sleep(delay);
  }
}

/**
 * Espera con el cursor en movimiento: se desliza despacio hacia `focus` (lo
 * que está por pasar) y, si la espera sigue, se acerca un poco más, sin
 * quedarse quieto más de ~1 s.
 */
export async function holdUntil(page, promise, focus, { maxMs = 20000 } = {}) {
  let done = false;
  const p = Promise.resolve(promise).then((v) => { done = true; return v; }, (e) => { done = true; throw e; });
  const t0 = Date.now();
  let target = focus ?? TL.pos;
  let first = true;
  while (!done && Date.now() - t0 < maxMs) {
    const here = TL.pos;
    const tx = first ? target.x : here.x + (target.x - here.x) * 0.35 + rnd(-18, 18);
    const ty = first ? target.y : here.y + (target.y - here.y) * 0.35 + rnd(-12, 12);
    await moveTo(page, tx, ty, first ? 900 : rnd(900, 1100));
    first = false;
    await Promise.race([p.catch(() => {}), sleep(250)]);
  }
  return p;
}
/** Pausa corta con el cursor desplazándose hacia el siguiente objetivo. */
export async function drift(page, toward, ms) {
  if (ms <= 1000) return sleep(ms);
  const here = TL.pos;
  const t = toward ?? { x: here.x + rnd(-40, 40), y: here.y + rnd(-25, 25) };
  await moveTo(page, here.x + (t.x - here.x) * 0.6, here.y + (t.y - here.y) * 0.6, Math.min(ms, 1400));
}

/* ---------------- Selects nativos ---------------- */
function screenPx() {
  const buf = execSync(`ffmpeg -loglevel error -f x11grab -video_size 1920x1080 -i ${DISPLAY} -frames:v 1 -f rawvideo -pix_fmt rgb24 -`, { maxBuffer: 1 << 24 });
  return (x, y) => { const i = (Math.round(y) * 1920 + Math.round(x)) * 3; return [buf[i], buf[i + 1], buf[i + 2]]; };
}

/**
 * Elige una opción de un <select> nativo como una persona: clic para abrir
 * el menú, el cursor viaja a la opción y hace clic (clic real de X: el menú
 * nativo no existe para CDP). La geometría del menú se lee de la pantalla.
 */
export async function chooseOption(page, select, label) {
  const loc = typeof select === "string" ? page.locator(select).first() : select;
  const opts = await loc.locator("option").allTextContents();
  const idx = opts.findIndex((o) => o.trim() === label || o.trim().startsWith(label));
  if (idx < 0) throw new Error(`opción "${label}" no está en ${opts.join(" | ")}`);
  const cur = await loc.evaluate((s) => s.selectedIndex);
  const { bb } = await boxOf(page, loc);
  parkXPointer(); // el menú nativo resalta lo que tenga debajo el puntero REAL
  await clickOn(page, loc, { dx: 0.35, after: 0 });
  // Leer el menú de la pantalla hasta que la opción actual resaltada esté
  // justo donde debe (debajo o encima del select): así no se hace clic sobre
  // un menú a medio dibujar.
  let top = -1, bot = -1, h = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    await sleep(attempt === 0 ? 300 : 150);
    const px = screenPx();
    const x = bb.x + 6;
    top = -1; bot = -1;
    for (let y = 0; y < 1080; y++) {
      const [r, g, b] = px(x, y);
      const blue = b > 170 && r < 90 && g > 70 && g < 150;
      if (blue) { if (top < 0) top = y; bot = y; } else if (top >= 0) break;
    }
    h = bot - top + 1;
    if (process.env.REC_DEBUG) console.log("[menu]", { attempt, top, bot, h, bb, cur });
    if (top < 0 || h < 16 || h > 40) continue;
    const below = Math.abs(top - (bb.y + bb.height + cur * h)) <= 6;
    const above = top < bb.y && Math.abs(top - (bb.y - (opts.length - cur) * h)) <= 8;
    if (below || above) break;
    top = -1;
  }
  if (top < 0) throw new Error("no pude leer el menú abierto para " + label);
  const ty = top + (idx - cur) * h + h / 2;
  await xClick(bb.x + Math.min(120, bb.width * 0.4), ty, { ms: Math.max(500, Math.min(800, 420 + Math.abs(ty - TL.pos.y) * 0.8)) });
  await page.mouse.move(bb.x + Math.min(120, bb.width * 0.4), ty).catch(() => {});
  await settle(page, 500);
  const now = await loc.evaluate((s) => s.options[s.selectedIndex].text.trim());
  if (!now.startsWith(label)) throw new Error(`el select quedó en "${now}" en vez de "${label}"`);
}

/* ---------------- Sesión ---------------- */
export async function login(page, who, { visible = false } = {}) {
  if (!visible) {
    await page.goto(`${BASE}/login`, { waitUntil: "load" });
    await page.fill("input[type=email]", EMAIL[who]); // fuera de cámara (preparación)
    await page.fill("input[type=password]", PASSWORD);
    await page.keyboard.press("Enter");
  } else {
    await clickOn(page, "input[type=email]", { after: 150 });
    await typeText(page, EMAIL[who], 65);
    await clickOn(page, "input[type=password]", { after: 150 });
    await typeText(page, PASSWORD, 65);
    await clickOn(page, "button[type=submit]", { after: 0 });
  }
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  await page.waitForLoadState("load").catch(() => {});
}

/** Sesión por API (contexto invisible que escribe en vivo). */
export async function apiClient(who, ip) {
  let cookie = "";
  const hdr = () => ({ origin: BASE, "x-forwarded-for": ip ?? `10.61.0.${Math.floor(rnd(20, 220))}`, ...(cookie ? { cookie } : {}) });
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { ...hdr(), "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL[who], password: PASSWORD }) });
  if (!r.ok) throw new Error(`login ${who}: ${r.status}`);
  cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return {
    async call(p, method = "GET", json) {
      const res = await fetch(BASE + p, { method, headers: { ...hdr(), ...(json !== undefined ? { "content-type": "application/json" } : {}) }, body: json !== undefined ? JSON.stringify(json) : undefined });
      const t = await res.text();
      if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${t.slice(0, 200)}`);
      try { return JSON.parse(t); } catch { return t; }
    },
  };
}

export async function smoothScroll(page, selector, dy, ms = 1400) {
  await page.evaluate(async ({ selector, dy, ms }) => {
    const el = selector ? document.querySelector(selector) : document.scrollingElement;
    if (!el) return;
    const start = el.scrollTop, t0 = performance.now();
    await new Promise((res) => {
      const f = (now) => { const t = Math.min(1, (now - t0) / ms); const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; el.scrollTop = start + dy * e; t < 1 ? requestAnimationFrame(f) : res(); };
      requestAnimationFrame(f);
    });
  }, { selector, dy, ms });
  active("scroll");
}

/* ---------------- Mocks ---------------- */
/**
 * Mensaje entrante simulado. NO bloquea: el webhook tarda ~1 s en procesarse
 * y el cursor debe seguir en movimiento mientras tanto (los clips esperan el
 * resultado visible con holdUntil).
 */
export function inbound(fields) {
  const seed = SEED();
  mark("mensaje entrante");
  const p = fetch(`${MOCK}/inbound`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phoneNumberId: seed.phoneNumberId, ...fields }) })
    .then(async (r) => { if (!r.ok) throw new Error(`inbound ${r.status} ${await r.text()}`); });
  p.catch((e) => console.error("[inbound]", e.message));
  return Promise.resolve();
}
export const phone = (n) => `5299855501${String(n).padStart(2, "0")}`;

/* ---------------- Medidor de fps del navegador ---------------- */
export async function fpsMeterStart(page) {
  await page.evaluate(() => {
    const m = (window.__fps = { t: [], on: true });
    const tick = (now) => { if (!m.on) return; m.t.push(now); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}
export async function fpsMeterStop(page) {
  return page.evaluate(() => {
    const m = window.__fps;
    if (!m) return null;
    m.on = false;
    const d = m.t.slice(1).map((t, i) => t - m.t[i]);
    const total = (m.t.at(-1) - m.t[0]) / 1000;
    return { rafFps: +(d.length / total).toFixed(1), longFramesPct: +((d.filter((x) => x > 25).length / d.length) * 100).toFixed(1) };
  });
}

/* ---------------- Grabación ---------------- */
export class Recorder {
  constructor(name) {
    this.name = name;
    this.file = path.join(MASTERS, `${name}.mkv`);
    this.log = path.join(OUT, "logs", `${name}.ffmpeg.log`);
    this.tlFile = path.join(MASTERS, `${name}.timeline.json`);
  }
  async start(page) {
    this.stderr = "";
    this.proc = spawn("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "info", "-stats_period", "1",
      "-f", "x11grab", "-draw_mouse", "0", "-framerate", String(FPS), "-video_size", "1920x1080",
      "-thread_queue_size", "1024", "-i", `${DISPLAY}.0+0,0`,
      // CFR: si x11grab no alcanza un cuadro, ffmpeg lo DUPLICA y lo cuenta en dup=.
      "-fps_mode", "cfr", "-r", String(FPS),
      "-c:v", "libx264", "-crf", "0", "-preset", "ultrafast", "-pix_fmt", "yuv444p", this.file,
    ], { stdio: ["pipe", "ignore", "pipe"] });
    this.proc.stderr.on("data", (d) => (this.stderr += d.toString()));
    const t = Date.now();
    while (!/frame=\s*[1-9]\d{2,}/.test(this.stderr)) {
      if (Date.now() - t > 30000) throw new Error("ffmpeg no arrancó");
      await sleep(100);
    }
    const base = [...this.stderr.matchAll(/frame=\s*(\d+).*?dup=(\d+)\s+drop=(\d+)/g)].pop();
    this.base = { frames: Number(base?.[1] ?? 0), dup: Number(base?.[2] ?? 0), drop: Number(base?.[3] ?? 0) };
    // Marcador de sincronía: un cuadrado magenta de ~150 ms en la esquina.
    this.marker = await page.evaluate(() => new Promise((res) => {
      const m = document.createElement("div");
      m.style.cssText = "position:fixed;left:0;top:0;width:64px;height:64px;background:#ff00ff;z-index:2147483647";
      document.documentElement.appendChild(m);
      requestAnimationFrame(() => requestAnimationFrame(() => { res(Date.now()); setTimeout(() => m.remove(), 150); }));
    }));
    await sleep(400);
    Object.assign(TL, { on: true, cursor: [], clicks: [], steps: [], events: [], typing: [], idle: [], lastActive: Date.now() });
    this.contentStart = Date.now();
  }
  async stop() {
    endStep();
    TL.on = false;
    this.contentEnd = Date.now();
    await sleep(300);
    const done = new Promise((r) => this.proc.on("close", r));
    this.proc.stdin.write("q");
    await done;
    writeFileSync(this.log, this.stderr);
    const last = [...this.stderr.matchAll(/frame=\s*(\d+).*?dup=(\d+)\s+drop=(\d+)/g)].pop();
    const b = this.base;
    const frames = Number(last?.[1] ?? 0) - b.frames, dup = Number(last?.[2] ?? 0) - b.dup, drop = Number(last?.[3] ?? 0) - b.drop;
    const tl = {
      name: this.name, marker: this.marker, contentStart: this.contentStart, contentEnd: this.contentEnd,
      startPos: this.startPos, cursor: TL.cursor, typing: TL.typing, clicks: TL.clicks, steps: TL.steps, events: TL.events, idle: TL.idle,
      capture: { frames, dup, drop, lossPct: +(((dup + drop) / Math.max(1, frames)) * 100).toFixed(2) },
    };
    writeFileSync(this.tlFile, JSON.stringify(tl, null, 1));
    console.log("[rec]", this.name, JSON.stringify(tl.capture), "pausas>1.2s:", TL.idle.length);
    return tl;
  }
}

/**
 * Scroll con la rueda del mouse (acción visible): pequeños pasos que Chromium
 * anima; el cursor acompaña el desplazamiento.
 */
export async function wheelScroll(page, dy, ms = 1400, { cursorTo } = {}) {
  const steps = Math.max(8, Math.round(ms / 45));
  const per = dy / steps;
  const move = cursorTo ? moveTo(page, cursorTo.x, cursorTo.y, ms) : Promise.resolve();
  const wheel = (async () => {
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, per);
      active("scroll");
      await sleep(ms / steps);
    }
  })();
  await Promise.all([move, wheel]);
  active("scroll");
}
