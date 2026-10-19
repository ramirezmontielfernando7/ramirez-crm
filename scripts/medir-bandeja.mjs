/**
 * Medición REPRODUCIBLE de lo que la Bandeja pide al servidor por cada aviso en
 * vivo (Paso 2, rendimiento de la Bandeja). Sirve igual ANTES y DESPUÉS de un
 * cambio: cuenta, con un navegador real, cuántas peticiones `/api/conversations*`
 * salen y cuántos bytes bajan por cada mensaje entrante.
 *
 *   1. (opcional, `--chats=N`) siembra N chats con 10 mensajes en la
 *      organización del usuario e2e, directo en la BD (`DATABASE_URL_MIGRATE`
 *      o `DATABASE_URL`). Se limpian con `--limpiar`.
 *   2. Cronometra (HTTP) la lista completa y, si existe, el contador ligero.
 *   3. Abre /inbox en Chromium y mide tres escenarios (cada uno tras dejar
 *      asentar la pantalla):
 *        - abrir un chat (el PATCH de «marcar leído» y su eco),
 *        - un mensaje entrante con OTRO chat abierto / ninguno abierto,
 *        - un mensaje entrante en el chat ABIERTO.
 *      También lista los eventos SSE que llegaron en cada uno.
 *
 * Uso: app con WA_MOCK_ENABLED=true (ver el job e2e de CI: `next start` con
 * ALLOW_CI_MOCKS=true) y el WhatsApp del usuario e2e conectado al wa-mock:
 *
 *   node --env-file=.env scripts/medir-bandeja.mjs --chats=5000
 *   node --env-file=.env scripts/medir-bandeja.mjs --limpiar
 *
 * Los bytes son del cuerpo ya descomprimido (JSON); la compresión del
 * transporte no cambia las proporciones. La respuesta crece con el número de
 * chats: compara siempre con el mismo `--chats`.
 */
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-4);
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const CHATS = Number(arg("chats") ?? 0);
const LIMPIAR = process.argv.includes("--limpiar");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kb = (n) => `${(n / 1024).toFixed(n > 10240 ? 0 : 1)} KB`;

let cookie = "";
async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...opts,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      "x-forwarded-for": `10.77.${Number(RUN) % 256}.9`,
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

/** Escucha /api/events (con la sesión) y anota los tipos que llegan. */
function escucharSse() {
  const tipos = [];
  const ctrl = new AbortController();
  const done = (async () => {
    const res = await fetch(`${BASE}/api/events`, { headers: { cookie }, signal: ctrl.signal });
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const type = buf.slice(0, i).match(/^event: (.+)$/m)?.[1];
        buf = buf.slice(i + 2);
        if (type) tipos.push(type);
      }
    }
  })().catch(() => {});
  return { tipos, stop: () => (ctrl.abort(), done) };
}

async function sembrar(sql, orgId, n) {
  const [etapa] = await sql`select id from pipeline_stage where organization_id = ${orgId} and kind = 'open' order by position limit 1`;
  const lote = 1000;
  for (let desde = 1; desde <= n; desde += lote) {
    const hasta = Math.min(n, desde + lote - 1);
    await sql`
      insert into contact (id, organization_id, name, wa_identity, phone)
      select 'ctperf_${sql.unsafe(RUN)}_' || g, ${orgId}, 'Perf ${sql.unsafe(RUN)} ' || g,
             '5255' || '${sql.unsafe(RUN)}' || lpad(g::text, 4, '0'), '5255' || '${sql.unsafe(RUN)}' || lpad(g::text, 4, '0')
      from generate_series(${desde}::int, ${hasta}::int) g`;
    await sql`
      insert into conversation (id, organization_id, contact_id, last_message_at, last_inbound_at, unread_count, created_at, updated_at)
      select 'cvperf_${sql.unsafe(RUN)}_' || g, ${orgId}, 'ctperf_${sql.unsafe(RUN)}_' || g,
             now() - (g || ' minutes')::interval - interval '1 day', now() - (g || ' minutes')::interval - interval '1 day',
             (g % 7 = 0)::int, now() - interval '90 days', now() - (g || ' minutes')::interval
      from generate_series(${desde}::int, ${hasta}::int) g`;
    await sql`
      insert into lead (id, organization_id, contact_id, stage_id)
      select 'ldperf_${sql.unsafe(RUN)}_' || g, ${orgId}, 'ctperf_${sql.unsafe(RUN)}_' || g, ${etapa.id}
      from generate_series(${desde}::int, ${hasta}::int) g`;
    await sql`
      insert into message (id, organization_id, conversation_id, direction, type, text, created_at)
      select 'msgperf_${sql.unsafe(RUN)}_' || g || '_' || k, ${orgId}, 'cvperf_${sql.unsafe(RUN)}_' || g,
             case when k % 2 = 0 then 'in' else 'out' end, 'text', 'Mensaje de prueba ' || k || ' del chat ' || g,
             now() - (g || ' minutes')::interval - interval '1 day' - ((10 - k) || ' seconds')::interval
      from generate_series(${desde}::int, ${hasta}::int) g, generate_series(1, 10) k`;
  }
  await sql`analyze`;
}

async function limpiar(sql, orgId) {
  // Todo cuelga de contact con ON DELETE CASCADE (conversación, mensajes, lead).
  const r = await sql`delete from contact where organization_id = ${orgId} and id like 'ctperf\\_%'`;
  console.log(`Sembrados borrados: ${r.count} contactos (con sus chats y mensajes).`);
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

  const dbUrl = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
  if ((CHATS || LIMPIAR) && !dbUrl) throw new Error("Falta DATABASE_URL_MIGRATE (o DATABASE_URL) para sembrar/limpiar.");
  const sql = dbUrl ? postgres(dbUrl, { max: 2 }) : null;
  const [org] = sql ? await sql`select m.organization_id as id from member m join "user" u on u.id = m.user_id where u.email = ${email} limit 1` : [];
  if (LIMPIAR) {
    await limpiar(sql, org.id);
    await sql.end();
    return;
  }
  if (CHATS) {
    console.log(`Sembrando ${CHATS} chats (10 mensajes cada uno)…`);
    await sembrar(sql, org.id, CHATS);
  }
  if (sql) await sql.end();

  /* ---- 1. Cronómetro HTTP de la lista y del contador ---- */
  const cronometra = async (path) => {
    const ts = [];
    let bytes = 0;
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      const r = await api(path);
      ts.push(performance.now() - t);
      if (!r.res.ok) return null;
      bytes = Buffer.byteLength(r.text);
    }
    ts.sort((a, b) => a - b);
    return { ms: ts[2], bytes };
  };
  const lista = await cronometra("/api/conversations");
  const contador = await cronometra("/api/conversations/unread");
  const total = (await api("/api/conversations")).json?.conversations?.length ?? 0;
  console.log(`\n== Chats en la Bandeja principal: ${total} ==`);
  console.log(`GET /api/conversations         : ${lista.ms.toFixed(0)} ms, ${kb(lista.bytes)}`);
  console.log(contador ? `GET /api/conversations/unread  : ${contador.ms.toFixed(0)} ms, ${kb(contador.bytes)}` : "GET /api/conversations/unread  : no existe (404)");

  /* ---- 2. Navegador: peticiones y bytes por escenario ---- */
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-MX" });
    await ctx.addCookies(
      cookie.split("; ").map((c) => {
        const i = c.indexOf("=");
        return { name: c.slice(0, i), value: c.slice(i + 1), url: BASE };
      })
    );
    const page = await ctx.newPage();
    let capturas = [];
    const pendientes = new Set();
    page.on("response", (res) => {
      const u = new URL(res.url());
      if (!u.pathname.startsWith("/api/conversations")) return;
      const p = (async () => {
        const body = await res.body().catch(() => Buffer.alloc(0));
        const clase = u.pathname === "/api/conversations" ? `lista${u.search}` : u.pathname === "/api/conversations/unread" ? "contador" : u.pathname.endsWith("/messages") ? "mensajes del chat" : `${res.request().method()} chat`;
        capturas.push({ clase, bytes: body.length });
      })();
      pendientes.add(p);
      p.finally(() => pendientes.delete(p));
    });
    await page.goto(`${BASE}/inbox`, { timeout: 180000, waitUntil: "domcontentloaded" });
    await page.locator("[data-conversation-row]").first().waitFor({ timeout: 120000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(2000);

    const sse = escucharSse();
    await sleep(500);
    const escenario = async (titulo, accion) => {
      await Promise.all(pendientes);
      capturas = [];
      sse.tipos.length = 0;
      await accion();
      await sleep(3000); // > debounce de 250 ms y a la IA/estados que lleguen
      await Promise.all(pendientes);
      const por = new Map();
      for (const c of capturas) {
        const a = por.get(c.clase) ?? { n: 0, bytes: 0 };
        a.n++;
        a.bytes += c.bytes;
        por.set(c.clase, a);
      }
      const n = capturas.length;
      const bytes = capturas.reduce((a, c) => a + c.bytes, 0);
      console.log(`\n-- ${titulo}`);
      console.log(`   avisos SSE: ${sse.tipos.length ? sse.tipos.join(", ") : "ninguno"}`);
      for (const [clase, a] of por) console.log(`   ${String(a.n).padStart(2)} × ${clase.padEnd(24)} ${kb(a.bytes)}`);
      console.log(`   TOTAL: ${n} peticiones, ${kb(bytes)}`);
      return { n, bytes };
    };

    const filas = await page.locator("[data-conversation-row]").evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute("data-conversation-row")));
    const dtos = (await api("/api/conversations")).json.conversations;
    const telDe = (id) => dtos.find((c) => c.id === filas[id])?.contact.phone;
    const entrante = (from, n) =>
      api("/api/dev/wa-mock/inbound", { method: "POST", body: JSON.stringify({ phoneNumberId: "PN-E2E", from, name: `Medición ${from}`, waMessageId: `wamid.medir.${RUN}.${Date.now()}.${n}`, text: `Hola, mensaje ${n}` }) });

    console.log("\n== Peticiones y bytes por cada evento (navegador real, /inbox) ==");
    const r = {};
    r.cerrado = await escenario("A. Entra un mensaje; NINGÚN chat abierto", () => entrante(telDe(1), 1));
    r.abrir = await escenario("B. Abrir un chat (marcar leído)", () => page.locator(`[data-conversation-row="${filas[0]}"]`).first().click());
    r.abierto = await escenario("C. Entra un mensaje en el chat ABIERTO", () => entrante(telDe(0), 2));
    await sse.stop();
    console.log("\nResumen (peticiones / KB):");
    console.log(`  A mensaje, chat cerrado : ${r.cerrado.n} / ${kb(r.cerrado.bytes)}`);
    console.log(`  B abrir un chat         : ${r.abrir.n} / ${kb(r.abrir.bytes)}`);
    console.log(`  C mensaje, chat abierto : ${r.abierto.n} / ${kb(r.abierto.bytes)}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
