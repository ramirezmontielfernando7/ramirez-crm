/**
 * Utilidades de grabación: Xvfb + Chromium headed (Playwright solo navega),
 * cursor inyectado con halo, movimiento suave, espera de animaciones y
 * captura con ffmpeg x11grab a 60 fps (maestro sin pérdida).
 */
import { spawn, execSync } from "node:child_process";
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
for (const d of [OUT, MASTERS, path.join(OUT, "videos"), path.join(OUT, "logs")]) mkdirSync(d, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const EMAIL = {
  carlos: "carlos@elmartillo.demo", sofia: "sofia@elmartillo.demo", marcela: "marcela@elmartillo.demo",
  diego: "diego@elmartillo.demo", paola: "paola@elmartillo.demo", ivan: "ivan@elmartillo.demo",
  andrea: "andrea@elmartillo.demo", hector: "hector@elmartillo.demo", lucia: "lucia@elmartillo.demo",
};

/* ---------------- Xvfb ---------------- */
/**
 * Gestor de ventanas mínimo: sin él, Chromium en X11 queda en 1919x1079 y
 * --kiosk no aplica. matchbox sin barra de título deja 1920x1080 exactos.
 */
function ensureWm() {
  try {
    execSync("pidof matchbox-window-manager > /dev/null");
  } catch {
    const wm = spawn("matchbox-window-manager", ["-use_titlebar", "no", "-use_cursor", "no"], {
      detached: true, stdio: "ignore", env: { ...process.env, DISPLAY },
    });
    wm.unref();
    execSync("sleep 0.5");
  }
}

export function ensureXvfb() {
  try {
    execSync(`xdpyinfo -display ${DISPLAY} > /dev/null 2>&1`);
    ensureWm();
    return;
  } catch {}
  const p = spawn("Xvfb", [DISPLAY, "-screen", "0", "1920x1080x24", "-nolisten", "tcp", "-ac"], { detached: true, stdio: "ignore" });
  p.unref();
  for (let i = 0; i < 50; i++) {
    try {
      execSync(`xdpyinfo -display ${DISPLAY} > /dev/null 2>&1`);
      ensureWm();
      return;
    } catch {}
    execSync("sleep 0.1");
  }
  throw new Error("Xvfb no arrancó");
}

/** Zona horaria "Etc/GMT±N" para que la hora local del video sea de día (~11:00). */
export function daytimeZone() {
  if (process.env.REC_TZ) return process.env.REC_TZ;
  const utcH = new Date().getUTCHours();
  let off = 11 - utcH;
  if (off > 12) off -= 24;
  if (off < -12) off += 24;
  return off === 0 ? "Etc/GMT" : `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
}

/* ---------------- Cursor ---------------- */
const CURSOR_SCRIPT = `
(() => {
  if (window.__recCursor) return;
  window.__recCursor = true;
  const install = () => {
    if (!document.body) return requestAnimationFrame(install);
    const halo = document.createElement('div');
    halo.id = '__rec_halo';
    halo.style.cssText = 'position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(18,153,157,.16);box-shadow:0 0 0 1.5px rgba(18,153,157,.35);pointer-events:none;z-index:2147483646;transition:transform .18s ease, background .18s ease;will-change:transform;';
    const arrow = document.createElement('div');
    arrow.id = '__rec_cursor';
    arrow.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;will-change:transform;';
    arrow.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.6 13.8 L10.6 20.4 L13.4 19.2 L10.4 12.6 L16.6 12.6 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(halo);
    document.documentElement.appendChild(arrow);
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem('__recPos') || 'null'); } catch {}
    const pos = window.__recPos || saved || { x: -100, y: -100 };
    const place = (x, y) => {
      window.__recPos = { x, y };
      halo.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      arrow.style.transform = 'translate(' + (x - 3) + 'px,' + (y - 2) + 'px)';
    };
    place(pos.x, pos.y);
    // Deslizamiento del cursor a 60 Hz (requestAnimationFrame): el evento real
    // del mouse llega solo al final, así el trazo no depende de CDP (~30 Hz).
    window.__recGlide = (fx, fy, x, y, ms) => new Promise((res) => {
      window.__recGliding = true;
      const t0 = performance.now();
      const ez = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        const e = ez(t);
        place(fx + (x - fx) * e, fy + (y - fy) * e);
        if (t < 1) requestAnimationFrame(step);
        else {
          window.__recGliding = false;
          try { sessionStorage.setItem('__recPos', JSON.stringify({ x, y })); } catch {}
          res();
        }
      };
      requestAnimationFrame(step);
    });
    addEventListener('mousemove', (e) => { if (!window.__recGliding) place(e.clientX, e.clientY); }, true);
    addEventListener('mousedown', () => { halo.style.background = 'rgba(18,153,157,.38)'; halo.style.transform += ' scale(.8)'; }, true);
    addEventListener('mouseup', () => { halo.style.background = 'rgba(18,153,157,.16)'; const p = window.__recPos; place(p.x, p.y); }, true);
  };
  install();
})();`;

/* ---------------- Navegador ---------------- */
export async function launch({ headed = true } = {}) {
  if (headed) ensureXvfb();
  const browser = await chromium.launch({
    headless: !headed,
    executablePath: CHROME,
    env: { ...process.env, DISPLAY },
    ignoreDefaultArgs: ["--enable-automation"],
    args: headed
      ? [
          "--kiosk",
          "--window-position=0,0",
          "--window-size=1920,1080",
          ...(process.env.REC_WINARGS ? process.env.REC_WINARGS.split(" ") : []),
          // Medido en este equipo (sin GPU): con SwiftShader una animación a
          // pantalla completa cae a ~23 fps; el compositor por software
          // (--disable-gpu) sostiene 60. REC_GL=swiftshader para comparar.
          ...(process.env.REC_GL === "swiftshader"
            ? ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-vsync=false"]
            : ["--disable-gpu"]),
          "--enable-smooth-scrolling",
          "--hide-scrollbars",
          "--disable-infobars",
          "--noerrdialogs",
          "--disable-features=Translate,MediaRouter",
          "--disable-background-networking",
          "--disable-component-update",
          "--no-first-run",
          "--lang=es-MX",
        ]
      : ["--disable-background-networking", "--lang=es-MX"],
  });
  return browser;
}

export async function newContext(browser, { ip = "10.60.0." + Math.floor(Math.random() * 200 + 20), cursor = true, dsf = 1, theme = "light" } = {}) {
  const ctx = await browser.newContext({
    ...(dsf === 1 && cursor ? { viewport: null } : { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dsf }),
    locale: "es-MX",
    timezoneId: daytimeZone(),
    colorScheme: theme,
    extraHTTPHeaders: { "x-forwarded-for": ip },
    reducedMotion: "no-preference",
  });
  if (cursor) await ctx.addInitScript(CURSOR_SCRIPT);
  return ctx;
}

export async function login(page, who, { visible = false } = {}) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  if (visible) {
    await settle(page, 600);
    await clickOn(page, 'input[type=email]');
    await typeHuman(page, EMAIL[who]);
    await clickOn(page, 'input[type=password]');
    await typeHuman(page, PASSWORD, 45);
    await sleep(400);
    await clickOn(page, 'button[type=submit]');
  } else {
    await page.fill("input[type=email]", EMAIL[who]);
    await page.fill("input[type=password]", PASSWORD);
    await page.keyboard.press("Enter");
  }
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  await page.waitForLoadState("load").catch(() => {});
}

/** Sesión por API (para el contexto invisible que escribe en vivo). */
export async function apiClient(who, ip) {
  let cookie = "";
  const hdr = () => ({ origin: BASE, "x-forwarded-for": ip ?? `10.61.0.${Math.floor(Math.random() * 200 + 20)}`, ...(cookie ? { cookie } : {}) });
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { ...hdr(), "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL[who], password: PASSWORD }),
  });
  if (!r.ok) throw new Error(`login ${who}: ${r.status}`);
  cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return {
    async call(p, method = "GET", json) {
      const res = await fetch(BASE + p, {
        method,
        headers: { ...hdr(), ...(json !== undefined ? { "content-type": "application/json" } : {}) },
        body: json !== undefined ? JSON.stringify(json) : undefined,
      });
      const t = await res.text();
      if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${t.slice(0, 200)}`);
      try { return JSON.parse(t); } catch { return t; }
    },
  };
}

/* ---------------- Movimiento y espera ---------------- */
const posOf = new WeakMap();

/** Auditoría de quietud: registra cada tramo > 2.5 s sin cursor ni teclado. */
export const audit = { on: false, last: 0, gaps: [], t0: 0 };
export function markActive(label) {
  const now = Date.now();
  if (audit.on && audit.last && now - audit.last > 2500) {
    audit.gaps.push({ at: +((audit.last - audit.t0) / 1000).toFixed(1), seconds: +((now - audit.last) / 1000).toFixed(1), before: label });
  }
  audit.last = now;
}

export async function moveTo(page, x, y, ms) {
  const from = posOf.get(page) ?? { x: 960, y: 620 };
  const dist = Math.hypot(x - from.x, y - from.y);
  const dur = Math.round(ms ?? Math.min(950, Math.max(320, 240 + dist * 0.55)));
  markActive("mover");
  const glided = await page
    .evaluate(([fx, fy, tx, ty, d]) => (window.__recGlide ? window.__recGlide(fx, fy, tx, ty, d).then(() => true) : false), [from.x, from.y, x, y, dur])
    .catch(() => false);
  if (!glided) await sleep(dur);
  await page.mouse.move(x, y); // el evento real (hover) en el destino
  posOf.set(page, { x, y });
  markActive("mover");
}

/**
 * Espera con el cursor vivo: en vez de quedarse inmóvil, se desliza despacio
 * hacia `focus` (lo que está por pasar) o deriva poco alrededor de donde está.
 */
export async function hold(page, ms, focus) {
  const end = Date.now() + ms;
  if (ms <= 1300) {
    await sleep(ms);
    return;
  }
  let first = true;
  while (Date.now() < end - 500) {
    const left = end - Date.now();
    const here = posOf.get(page) ?? { x: 960, y: 620 };
    const base = first && focus ? focus : here;
    const jitter = first && focus ? 0 : 1;
    const tx = Math.max(20, Math.min(1900, base.x + jitter * (Math.random() * 70 - 35)));
    const ty = Math.max(20, Math.min(1060, base.y + jitter * (Math.random() * 44 - 22)));
    const d = Math.min(left - 200, first && focus ? 900 : 1100 + Math.random() * 500);
    if (d < 350) break;
    await moveTo(page, tx, ty, d);
    first = false;
    await sleep(Math.min(Math.max(0, end - Date.now()), 250 + Math.random() * 350));
  }
  const rest = end - Date.now();
  if (rest > 0) await sleep(rest);
}

/** Espera a que ocurra algo (respuesta del bot, un mensaje) con el cursor vivo. */
export async function holdUntil(page, promise, focus, maxMs = 20000) {
  let done = false;
  const p = Promise.resolve(promise).finally(() => (done = true));
  const t0 = Date.now();
  let first = true;
  while (!done && Date.now() - t0 < maxMs) {
    const here = posOf.get(page) ?? { x: 960, y: 620 };
    const base = first && focus ? focus : here;
    const j = first && focus ? 0 : 1;
    await moveTo(page, base.x + j * (Math.random() * 60 - 30), base.y + j * (Math.random() * 40 - 20), first && focus ? 850 : 1200);
    first = false;
    await Promise.race([p.catch(() => {}), sleep(300)]);
  }
  return p;
}

export function posOfPage(page) {
  return posOf.get(page) ?? { x: 960, y: 620 };
}

async function box(page, target) {
  const loc = typeof target === "string" ? page.locator(target).first() : target;
  await loc.waitFor({ state: "visible", timeout: 15000 });
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const b = await loc.boundingBox();
  if (!b) throw new Error("sin caja: " + target);
  return { loc, b };
}

export async function hover(page, target, { dx = 0.5, dy = 0.5, ms } = {}) {
  const { b } = await box(page, target);
  await moveTo(page, b.x + b.width * dx, b.y + b.height * dy, ms);
  await sleep(150);
}

export async function clickOn(page, target, { dx = 0.5, dy = 0.5, pause = 850, ms } = {}) {
  const { b } = await box(page, target);
  const x = b.x + b.width * dx;
  const y = b.y + b.height * dy;
  await moveTo(page, x, y, ms);
  await sleep(120);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
  markActive("clic");
  // La pausa tras la transición (mín. 800 ms) espera las animaciones; si es
  // larga, el cursor sigue vivo cerca de lo que se acaba de abrir.
  await settle(page, Math.min(pause, 1100));
  if (pause > 1100) await hold(page, pause - 1100);
}

export async function typeHuman(page, text, delay = 55) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    markActive("teclear");
    await sleep(delay + Math.random() * 35);
  }
}

/** Espera a que terminen las animaciones (document.getAnimations) + pausa mínima. */
export async function settle(page, minMs = 800) {
  const t0 = Date.now();
  await page
    .waitForFunction(
      () => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming?.().iterations !== Infinity).length === 0,
      null,
      { timeout: 4000, polling: 50 }
    )
    .catch(() => {});
  const left = minMs - (Date.now() - t0);
  if (left > 0) await sleep(left);
}

export async function smoothScroll(page, selector, dy, ms = 1400) {
  await page.evaluate(
    async ({ selector, dy, ms }) => {
      const el = selector ? document.querySelector(selector) : document.scrollingElement;
      if (!el) return;
      const start = el.scrollTop;
      const t0 = performance.now();
      await new Promise((res) => {
        const step = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          el.scrollTop = start + dy * e;
          t < 1 ? requestAnimationFrame(step) : res();
        };
        requestAnimationFrame(step);
      });
    },
    { selector, dy, ms }
  );
}

/* ---------------- Mocks ---------------- */
export async function inbound(fields) {
  const seed = SEED();
  const r = await fetch(`${MOCK}/inbound`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumberId: seed.phoneNumberId, ...fields }),
  });
  if (!r.ok) throw new Error(`inbound ${r.status} ${await r.text()}`);
}
export const phone = (n) => `5299855501${String(n).padStart(2, "0")}`;

/* ---------------- Medidor de fps del navegador ---------------- */
/** Cuenta callbacks de requestAnimationFrame: lo que Chromium realmente pinta. */
export async function fpsMeterStart(page) {
  await page.evaluate(() => {
    const m = (window.__fps = { t: [], on: true });
    const tick = (now) => {
      if (!m.on) return;
      m.t.push(now);
      requestAnimationFrame(tick);
    };
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
    const slow = d.filter((x) => x > 25).length;
    return { rafFps: +(d.length / total).toFixed(1), longFramesPct: +((slow / d.length) * 100).toFixed(1), p95ms: +[...d].sort((a, b) => a - b)[Math.floor(d.length * 0.95)].toFixed(1) };
  });
}

/* ---------------- Grabación ---------------- */
export class Recorder {
  constructor(name) {
    this.name = name;
    this.file = path.join(MASTERS, `${name}.mkv`);
    this.log = path.join(OUT, "logs", `${name}.ffmpeg.log`);
  }
  async start() {
    this.stderr = "";
    this.proc = spawn(
      "ffmpeg",
      [
        "-y", "-hide_banner", "-loglevel", "info", "-stats_period", "1",
        "-f", "x11grab", "-draw_mouse", "0", "-framerate", String(FPS), "-video_size", "1920x1080",
        "-thread_queue_size", "1024", "-i", `${DISPLAY}.0+0,0`,
        // CFR: si x11grab no alcanza a capturar un cuadro a tiempo, ffmpeg lo
        // DUPLICA para rellenar y lo cuenta en dup= (la cifra honesta).
        "-fps_mode", "cfr", "-r", String(FPS),
        "-c:v", "libx264", "-crf", "0", "-preset", "ultrafast", "-pix_fmt", "yuv444p",
        this.file,
      ],
      { stdio: ["pipe", "ignore", "pipe"] }
    );
    this.proc.stderr.on("data", (d) => (this.stderr += d.toString()));
    // Esperar a que ffmpeg YA esté entregando cuadros (el arranque puede
    // tardar segundos) y dejar pasar su jitter inicial antes del guion.
    const t = Date.now();
    while (!/frame=\s*[1-9]\d{2,}/.test(this.stderr)) {
      if (Date.now() - t > 30000) throw new Error("ffmpeg no arrancó");
      await sleep(100);
    }
    this.t0 = Date.now();
    audit.on = true; audit.gaps = []; audit.t0 = this.t0; audit.last = this.t0;
    await sleep(300);
    const base = [...this.stderr.matchAll(/frame=\s*(\d+).*?dup=(\d+)\s+drop=(\d+)/g)].pop();
    this.base = { frames: Number(base?.[1] ?? 0), dup: Number(base?.[2] ?? 0), drop: Number(base?.[3] ?? 0) };
  }
  async stop() {
    const done = new Promise((r) => this.proc.on("close", r));
    this.proc.stdin.write("q");
    await done;
    markActive("fin");
    audit.on = false;
    const wall = (Date.now() - this.t0) / 1000;
    writeFileSync(this.log, this.stderr);
    const last = [...this.stderr.matchAll(/frame=\s*(\d+).*?dup=(\d+)\s+drop=(\d+)/g)].pop();
    const lastSimple = [...this.stderr.matchAll(/frame=\s*(\d+)/g)].pop();
    // Solo lo ocurrido desde que arrancó el guion (el arranque se recorta).
    const b = this.base ?? { frames: 0, dup: 0, drop: 0 };
    const frames = Number(last?.[1] ?? lastSimple?.[1] ?? 0) - b.frames;
    const dup = Number(last?.[2] ?? 0) - b.dup;
    const drop = Number(last?.[3] ?? 0) - b.drop;
    const probe = JSON.parse(
      execSync(`ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets,r_frame_rate:format=duration -of json "${this.file}"`).toString()
    );
    const dur = Number(probe.format.duration);
    const stats = {
      clip: this.name, wallSeconds: +wall.toFixed(2), durationSeconds: +dur.toFixed(2), frames,
      dup, drop, lossPct: +(((dup + drop) / Math.max(1, frames)) * 100).toFixed(2),
      bytes: Number(execSync(`stat -c %s "${this.file}"`).toString()),
      idleGaps: audit.gaps,
    };
    const statsFile = path.join(OUT, "logs", "stats.json");
    const all = existsSync(statsFile) ? JSON.parse(readFileSync(statsFile, "utf8")) : {};
    all[this.name] = stats;
    writeFileSync(statsFile, JSON.stringify(all, null, 2));
    console.log("[rec]", JSON.stringify(stats));
    return stats;
  }
}

/**
 * Pantalla completa real (sin pestañas ni barra de URL). Sin gestor de
 * ventanas en el Xvfb, --kiosk no surte efecto con las ventanas que abre
 * Playwright; el estado `fullscreen` por CDP sí.
 */
export async function fullscreen(page) {
  const cdp = await page.context().newCDPSession(page);
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } }).catch(() => {});
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { left: 0, top: 0, width: 1920, height: 1080 } }).catch(() => {});
  await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "fullscreen" } });
  await sleep(600);
  const vp = await page.evaluate(() => [innerWidth, innerHeight]);
  if (vp[0] !== 1920 || vp[1] !== 1080) throw new Error("pantalla completa fallida: " + vp);
}
