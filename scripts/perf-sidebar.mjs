/**
 * Medición de la fluidez del menú lateral (expandido → íconos → oculto →
 * expandido) con Playwright + CDP, CPU a 4x. No es un test: es un banco de
 * medida para comparar antes/después con números.
 *
 * Por transición (desde el clic hasta 700 ms después) reporta:
 *  - cuadros: intervalos de rAF > 25 ms (≈ cuadro perdido a 60 Hz) y el peor;
 *  - tareas largas (RunTask del hilo principal > 50 ms) y la más larga;
 *  - Layout: cuántos y su tiempo total; recálculo de estilo y pintado;
 *  - renders de React por zona (menú / contenido / otros), contando los
 *    componentes que hicieron trabajo en cada commit (gancho de DevTools
 *    falso: funciona con el build de producción).
 *
 * Corre N veces (default 5) y da la MEDIANA de cada número.
 *
 * Uso (app en build de producción, BD migrada, WA_MOCK_ENABLED=true):
 *   node --env-file=.env scripts/perf-sidebar.mjs [--runs 5] [--json salida.json]
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PN = "PN-PERF-1";
const EMAIL = "perf@vocero.test";
const PASSWORD = "password-perf-123";
const args = process.argv.slice(2);
// Cada "corrida" son dos pasadas: una sin gancho (cuadros, tareas, trazas) y
// otra con él (renders). La mediana de cada número sale de su pasada.
const RUNS = (Number(args[args.indexOf("--runs") + 1]) || 5) * 2;
const JSON_OUT = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const WINDOW_MS = 700;
// Los mocks de WhatsApp no existen en producción: la siembra se hace contra
// `next dev` (--seed-only) y la medida contra el build (--no-seed).
const SEED_ONLY = args.includes("--seed-only");
const NO_SEED = args.includes("--no-seed");
// El gancho que cuenta renders recorre el árbol en cada commit: cuesta hilo
// principal. Los cuadros y tareas se miden SIN él; los renders, en corridas
// aparte con él.

let cookie = "";
async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

async function setup() {
  let r = await api("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.res.ok) {
    r = await api("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: "Perf Propietario" }),
    });
  }
  if (!r.res.ok) throw new Error(`login: ${r.res.status}`);
  if (NO_SEED) {
    await api("/api/preferences", { method: "PUT", body: JSON.stringify({ navMode: "expanded" }) });
    return;
  }
  await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-PERF", phoneNumberId: PN, token: "tok-perf" }),
  });
  // Una bandeja "de verdad": 60 chats con varios mensajes (idempotente por waMessageId).
  const existing = (await api("/api/conversations")).json?.conversations?.length ?? 0;
  if (existing < 60) {
    for (let i = 0; i < 60; i++) {
      for (let j = 0; j < 4; j++) {
        await api("/api/dev/wa-mock/inbound", {
          method: "POST",
          body: JSON.stringify({
            phoneNumberId: PN,
            from: `52155${String(10000000 + i)}`,
            name: `Cliente Perf ${i}`,
            text: `Mensaje ${j} del cliente ${i}: hola, quiero información de precios y horarios`,
            waMessageId: `wamid.perf.${i}.${j}`,
          }),
        });
      }
    }
  }
  // Arranca SIEMPRE expandido.
  await api("/api/preferences", { method: "PUT", body: JSON.stringify({ navMode: "expanded" }) });
}

/** Gancho de DevTools falso: cuenta componentes que renderizaron en cada commit. */
const HOOK = `(() => {
  const counts = { nav: 0, main: 0, other: 0, commits: 0 };
  window.__renders = counts;
  const zoneOf = (f) => {
    for (let p = f; p; p = p.return) {
      if (p.tag === 5 && p.stateNode && p.stateNode.tagName) {
        const t = p.stateNode.tagName;
        if (t === "ASIDE") return "nav";
        if (t === "MAIN") return "main";
      }
    }
    return "other";
  };
  // Un subárbol que React NO vuelve a renderizar conserva los MISMOS objetos
  // fiber (con la marca PerformedWork de su último render). Uno renderizado en
  // este commit es el "alterno": un objeto que no estaba en el árbol anterior.
  let prev = new WeakSet();
  const walk = (f, seen) => {
    while (f) {
      const isComp = f.tag === 0 || f.tag === 1 || f.tag === 11 || f.tag === 15 || f.tag === 14;
      if (isComp) {
        seen.add(f);
        // PerformedWork = 1: el componente se ejecutó.
        if ((f.flags & 1) && !prev.has(f)) counts[zoneOf(f)]++;
      }
      if (f.child) walk(f.child, seen);
      f = f.sibling;
    }
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject() { return 1; },
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      counts.commits++;
      const seen = new WeakSet();
      try { walk(root.current.child, seen); } catch {}
      prev = seen;
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };
})();`;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function analyzeTrace(buf) {
  const { traceEvents } = JSON.parse(buf.toString());
  // Hilo principal del renderer de la página.
  const mains = traceEvents.filter(
    (e) => e.name === "thread_name" && e.args?.name === "CrRendererMain"
  );
  const keys = new Set(mains.map((e) => `${e.pid}:${e.tid}`));
  const onMain = traceEvents.filter((e) => keys.has(`${e.pid}:${e.tid}`) && e.ph === "X");
  const sum = (name) => onMain.filter((e) => e.name === name).reduce((a, e) => a + (e.dur ?? 0), 0) / 1000;
  const tasks = onMain.filter((e) => e.name === "RunTask");
  const long = tasks.filter((e) => e.dur > 50_000);
  // Desglose de la tarea más larga (diagnóstico; se imprime con --why).
  const worst = tasks.reduce((a, e) => (!a || e.dur > a.dur ? e : a), null);
  if (worst && args.includes("--why")) {
    const inside = onMain.filter(
      (e) => e !== worst && e.ts >= worst.ts && e.ts + (e.dur ?? 0) <= worst.ts + worst.dur
    );
    const by = {};
    for (const e of inside) by[e.name] = (by[e.name] ?? 0) + (e.dur ?? 0) / 1000;
    const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`  tarea más larga ${(worst.dur / 1000).toFixed(1)} ms:`, top.map(([n, d]) => `${n}=${d.toFixed(1)}`).join(" "));
  }
  return {
    layoutCount: onMain.filter((e) => e.name === "Layout").length,
    layoutMs: sum("Layout"),
    styleMs: sum("UpdateLayoutTree"),
    paintMs: sum("Paint"),
    scriptMs: sum("FunctionCall") + sum("EvaluateScript"),
    longTasks: long.length,
    longestTaskMs: Math.max(0, ...tasks.map((e) => e.dur / 1000)),
  };
}

async function measureTransition(browser, page, cdp, prepare) {
  const click = await prepare();
  await page.evaluate(() => {
    const r = window.__renders;
    r.nav = r.main = r.other = r.commits = 0;
    window.__frames = [];
    const loop = (t) => {
      window.__frames.push(t);
      if (window.__frames.length < 400) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await page.waitForTimeout(100);
  await browser.startTracing(page, {
    categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8", "blink", "cc"],
  });
  const t0 = await page.evaluate(() => performance.now());
  await click();
  await page.waitForTimeout(WINDOW_MS);
  const buf = await browser.stopTracing();
  const { frames, renders } = await page.evaluate(
    ({ t0, win }) => ({
      frames: window.__frames.filter((t) => t >= t0 && t <= t0 + win),
      renders: { ...window.__renders },
    }),
    { t0, win: WINDOW_MS }
  );
  const gaps = frames.slice(1).map((t, i) => t - frames[i]);
  void cdp;
  return {
    droppedFrames: gaps.filter((g) => g > 25).reduce((a, g) => a + Math.round(g / 16.7) - 1, 0),
    worstFrameMs: Math.round(Math.max(0, ...gaps)),
    rendersNav: renders.nav,
    rendersMain: renders.main,
    rendersOther: renders.other,
    ...analyzeTrace(buf),
  };
}

async function main() {
  await setup();
  if (SEED_ONLY) return;
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ["--disable-gpu-vsync-throttling"],
  });
  const all = { "expandido→íconos": [], "íconos→oculto": [], "oculto→expandido": [] };
  for (let run = 0; run < RUNS; run++) {
    await api("/api/preferences", { method: "PUT", body: JSON.stringify({ navMode: "expanded" }) });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const [name, value] = cookie.split("; ").map((c) => c.split("="))[0];
    await ctx.addCookies(
      cookie.split("; ").map((c) => {
        const i = c.indexOf("=");
        return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE };
      })
    );
    void name;
    void value;
    const withHook = run % 2 === 1 || RUNS === 1;
    await ctx.addInitScript(withHook ? HOOK : "window.__renders = { nav: NaN, main: NaN, other: NaN, commits: 0 };");
    const page = await ctx.newPage();
    await page.goto(`${BASE}/inbox`);
    // Un chat abierto: el caso real (lista + hilo + panel).
    await page.getByText("Cliente Perf 1", { exact: true }).first().click();
    await page.waitForTimeout(1500);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.waitForTimeout(500);

    // Clic NATIVO en coordenadas calculadas antes de trazar: `locator.click()`
    // corre en la página sus comprobaciones (scroll, hit-test, estabilidad) y
    // con CPU a 4x eso solo ya parece una tarea larga del menú.
    const clickAt = (locator) => async () => {
      const box = await locator.boundingBox();
      if (!box) throw new Error("botón no visible");
      return () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    const toggle = clickAt(page.locator("aside button.nav-logo-btn"));
    const reveal = clickAt(page.getByRole("button", { name: "Mostrar el menú" }).first());

    all["expandido→íconos"].push(await measureTransition(browser, page, cdp, toggle));
    await page.waitForTimeout(400);
    all["íconos→oculto"].push(await measureTransition(browser, page, cdp, toggle));
    await page.waitForTimeout(400);
    all["oculto→expandido"].push(await measureTransition(browser, page, cdp, reveal));
    await page.waitForTimeout(400);
    await ctx.close();
    process.stdout.write(`corrida ${run + 1}/${RUNS} lista\n`);
  }
  await browser.close();

  const result = {};
  for (const [k, runs] of Object.entries(all)) {
    const keys = Object.keys(runs[0]);
    const hooked = runs.filter((_, i) => i % 2 === 1);
    const plain = runs.filter((_, i) => i % 2 === 0);
    result[k] = Object.fromEntries(
      keys.map((key) => {
        const src = key.startsWith("renders") ? hooked : plain;
        return [key, +median(src.map((r) => r[key])).toFixed(1)];
      })
    );
  }
  console.table(result);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ runs: RUNS, median: result, raw: all }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
