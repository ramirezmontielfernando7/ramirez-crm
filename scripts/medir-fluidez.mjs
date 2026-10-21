/**
 * Medición REPRODUCIBLE de la fluidez de la Bandeja (/inbox) en una
 * computadora lenta: cuánto tarda en pintar la lista y cuánto se traba al
 * bajar por ella, con 1,000 y 5,000 chats y el CPU frenado 4× y 6×.
 *
 * Los chats son FALSOS: el navegador intercepta `GET /api/conversations` y
 * responde N filas inventadas (con etapa, etiquetas, asignado, no leídos…),
 * así se mide solo el navegador, sin sembrar la BD ni depender del servidor.
 * Lo demás (sesión, catálogos, SSE) es la app real.
 *
 * Mide, por cada combinación:
 *   - «primera fila»: de la navegación a la primera fila visible.
 *   - «lista lista»: hasta que el hilo principal queda 1 s sin tareas largas
 *     (lo que siente la persona: ya puede hacer clic sin que se trabe).
 *   - «bloqueado»: suma de tareas largas (> 50 ms) durante la carga.
 *   - «scroll»: baja la lista en 20 pasos y suma las tareas largas y el peor
 *     cuadro (ms entre dos cuadros).
 *
 * Uso: app corriendo (como el job e2e de CI: `next start` con el .env de
 * pruebas) y el usuario e2e (lo crea si no existe):
 *
 *   node --env-file=.env scripts/medir-fluidez.mjs
 *   node --env-file=.env scripts/medir-fluidez.mjs --chats=1000 --cpu=4 --vueltas=3
 *
 * `--chats` y `--cpu` aceptan listas (`--chats=1000,5000 --cpu=4,6`, el valor
 * por defecto). Con `--vueltas=N` repite cada combinación y reporta la
 * mediana. Compara siempre en la MISMA máquina: las cifras absolutas cambian
 * de una computadora a otra, las proporciones antes/después no.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const lista = (v, def) => (v ?? def).split(",").map(Number).filter((n) => n > 0);
const CHATS = lista(arg("chats"), "1000,5000");
const CPU = lista(arg("cpu"), "4,6");
const VUELTAS = Math.max(1, Number(arg("vueltas") ?? 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cookie = "";
async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, json, text };
}

const NOMBRES = ["Ana", "Luis", "María", "José", "Carmen", "Jorge", "Lucía", "Pedro", "Sofía", "Raúl"];
const APELLIDOS = ["García", "López", "Hernández", "Martínez", "Pérez", "Sánchez", "Ramírez", "Torres"];
const TEXTOS = [
  "Hola, ¿tienen disponible el modelo en negro?",
  "Gracias, quedo pendiente 👍",
  "¿Cuál es el precio con envío a Monterrey?",
  "image",
  "Perfecto, mañana paso a recogerlo",
  "¿Aceptan pago con tarjeta?",
];

/** N chats falsos con la forma de `ConversationDto` (src/lib/types.ts). */
function chatsFalsos(n, { stages, tags, members }) {
  const ahora = Date.now();
  return Array.from({ length: n }, (_, i) => {
    const g = i + 1;
    const stage = stages.length ? stages[g % stages.length] : null;
    const last = new Date(ahora - g * 7 * 60_000).toISOString();
    const member = members.length && g % 3 ? members[g % members.length] : null;
    return {
      id: `cvfalso_${g}`,
      channel: "whatsapp",
      contact: {
        id: `ctfalso_${g}`,
        name: `${NOMBRES[g % NOMBRES.length]} ${APELLIDOS[g % APELLIDOS.length]} ${g}`,
        phone: `52155${String(g).padStart(8, "0")}`,
      },
      assignee: member ? { id: member.id, name: member.name } : null,
      stageName: stage?.name ?? null,
      stageColor: stage?.color ?? null,
      leadId: stage ? `ldfalso_${g}` : null,
      stageId: stage?.id ?? null,
      tags: tags.length && g % 2 ? [tags[g % tags.length]] : [],
      archivedAt: null,
      aiAvailable: true,
      aiEnabled: g % 5 !== 0,
      handoffAt: g % 11 === 0 ? last : null,
      handoffReason: g % 11 === 0 ? "pide_humano" : null,
      lastInboundAt: last,
      lastMessageAt: last,
      createdAt: new Date(ahora - 90 * 86_400_000).toISOString(),
      unreadCount: g % 7 === 0 ? (g % 4) + 1 : 0,
      windowOpen: g % 4 !== 0,
      windowRemainingMs: g % 4 !== 0 ? 3_600_000 * ((g % 23) + 1) : 0,
      preview: TEXTOS[g % TEXTOS.length],
      anuncio: g % 13 === 0 ? { headline: "Promo de temporada", sourceId: "ad_1", sourceType: "ad" } : null,
      campaign: g % 17 === 0 ? { state: "replied", name: "Venta nocturna" } : null,
    };
  });
}

const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Una medición: abre /inbox con N chats falsos y el CPU frenado `cpu` veces. */
async function medir(browser, chats, cpu) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-MX" });
  await ctx.addCookies(
    cookie.split("; ").map((c) => {
      const i = c.indexOf("=");
      return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE };
    })
  );
  // Tareas largas desde el primer momento (antes de que cargue la app).
  await ctx.addInitScript(() => {
    window.__largas = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__largas.push({ t: e.startTime, d: e.duration });
      }).observe({ type: "longtask", buffered: true });
    } catch {}
  });
  const cuerpo = JSON.stringify({ conversations: chats, campaignPending: 0 });
  const porId = new Map(chats.map((c) => [c.id, c]));
  await ctx.route(
    (u) => u.pathname === "/api/conversations",
    async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const q = new URL(route.request().url()).searchParams;
      if (q.get("view") === "campaigns") return route.fulfill({ json: { conversations: [] } });
      // Refresco por chat (`?ids=`): devuelve esos mismos chats falsos.
      const ids = q.get("ids");
      if (ids) {
        const solo = ids.split(",").map((id) => porId.get(id)).filter(Boolean);
        return route.fulfill({ json: { conversations: solo, campaignPending: 0 } });
      }
      return route.fulfill({ body: cuerpo, contentType: "application/json" });
    }
  );
  // Abrir un chat falso no debe pegarle a la BD.
  await ctx.route(/\/api\/conversations\/cvfalso_/, (route) => route.fulfill({ json: { messages: [] } }));

  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });

  const t0 = Date.now();
  await page.goto(`${BASE}/inbox`, { timeout: 300_000, waitUntil: "commit" });
  await page.locator("[data-conversation-row]").first().waitFor({ timeout: 300_000 });
  const primeraFila = Date.now() - t0;

  // «Lista lista»: 1 s seguido sin tareas largas.
  let ultima = 0;
  for (let espera = 0; espera < 120_000; espera += 250) {
    await sleep(250);
    const largas = await page.evaluate(() => window.__largas);
    const fin = largas.reduce((m, e) => Math.max(m, e.t + e.d), 0);
    ultima = fin;
    const ahora = await page.evaluate(() => performance.now());
    if (ahora - fin >= 1000) break;
  }
  const nav = await page.evaluate(() => performance.timeOrigin);
  const listaLista = Math.max(primeraFila, Math.round(nav + ultima - t0));
  const bloqueado = Math.round((await page.evaluate(() => window.__largas)).reduce((s, e) => s + e.d, 0));
  const filas = await page.locator("[data-conversation-row]").count();

  // Scroll: 20 pasos hasta el fondo de la lista, midiendo cuadros.
  const scroll = await page.evaluate(async () => {
    const fila = document.querySelector("[data-conversation-row]");
    let caja = fila?.parentElement;
    while (caja && !(caja.scrollHeight > caja.clientHeight && getComputedStyle(caja).overflowY !== "visible")) {
      caja = caja.parentElement;
    }
    if (!caja) return { bloqueado: 0, peorCuadro: 0 };
    const antes = window.__largas.length;
    const cuadros = [];
    let corriendo = true;
    let previo = performance.now();
    const tic = (t) => {
      cuadros.push(t - previo);
      previo = t;
      if (corriendo) requestAnimationFrame(tic);
    };
    requestAnimationFrame(tic);
    const paso = (caja.scrollHeight - caja.clientHeight) / 20;
    for (let i = 1; i <= 20; i++) {
      caja.scrollTop = paso * i;
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, 500));
    corriendo = false;
    const nuevas = window.__largas.slice(antes);
    return {
      bloqueado: Math.round(nuevas.reduce((s, e) => s + e.d, 0)),
      peorCuadro: Math.round(Math.max(0, ...cuadros)),
    };
  });

  await ctx.close();
  return { primeraFila, listaLista, bloqueado, filas, scrollBloqueado: scroll.bloqueado, peorCuadro: scroll.peorCuadro };
}

async function main() {
  if (!(await fetch(`${BASE}/api/health`).catch(() => null))?.ok) {
    console.error(`La app no responde en ${BASE}`);
    process.exit(1);
  }
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  if (!su.res.ok) su = await api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name: "Operador E2E" }) });
  if (!su.res.ok) throw new Error(`login: ${su.text}`);
  await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ wabaId: "WABA-E2E", phoneNumberId: "PN-E2E", token: "tok-e2e" }) });

  // Etapas y etiquetas reales: las filas falsas las usan para que las
  // cápsulas se pinten como en la vida real. Los asesores son de mentira.
  const stages = (await api("/api/pipeline/stages")).json?.stages ?? [];
  const tags = (await api("/api/contact-tags")).json?.tags ?? [];
  const members = [1, 2, 3].map((i) => ({ id: `usrfalso_${i}`, name: `Asesor ${i}` }));
  console.log(`Catálogos reales: ${stages.length} etapas, ${tags.length} etiquetas.`);

  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  const filas = [];
  try {
    // Una vuelta de calentamiento: compila la ruta y llena cachés.
    await medir(browser, chatsFalsos(50, { stages, tags, members }), 1);
    for (const n of CHATS) {
      const chats = chatsFalsos(n, { stages, tags, members });
      for (const cpu of CPU) {
        const vueltas = [];
        for (let v = 0; v < VUELTAS; v++) vueltas.push(await medir(browser, chats, cpu));
        const r = Object.fromEntries(Object.keys(vueltas[0]).map((k) => [k, mediana(vueltas.map((x) => x[k]))]));
        filas.push({ chats: n, cpu: `${cpu}×`, ...r });
        console.log(`  ${n} chats, CPU ${cpu}×: primera fila ${r.primeraFila} ms · lista lista ${r.listaLista} ms`);
      }
    }
  } finally {
    await browser.close();
  }
  const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
  console.log("\n| Chats | CPU | Primera fila | Lista lista | Bloqueado al cargar | Bloqueado al bajar | Peor cuadro | Filas en el DOM |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const f of filas) {
    console.log(`| ${f.chats} | ${f.cpu} | ${s(f.primeraFila)} | ${s(f.listaLista)} | ${s(f.bloqueado)} | ${s(f.scrollBloqueado)} | ${f.peorCuadro} ms | ${f.filas} |`);
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(filas));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
