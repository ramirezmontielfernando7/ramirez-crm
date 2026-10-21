/**
 * Self-test E2E — Fluidez PR 3: la Bandeja PAGINADA contra la BD real.
 *
 * Los guiones de siempre siembran pocos chats (menos de una página), así que
 * nunca llegaban a pedir una segunda. Este siembra MÁS de tres páginas (180
 * chats, directo en la BD) y comprueba, con el navegador y la app compilada:
 *
 *   - al entrar se pide UNA página (`?limit=50`), no la lista entera;
 *   - «Todas» y «No leídas» cuentan TODO (lo del servidor), no lo cargado;
 *   - bajar trae las páginas siguientes hasta el último chat, sin repetir;
 *   - la búsqueda encuentra un chat que aún no estaba cargado;
 *   - «No leídas» filtra en el servidor (todas sus filas son no leídas);
 *   - un mensaje que entra a un chat de muy abajo lo sube a la cima en vivo;
 *   - `/inbox?contact=…` abre un chat que no está en la primera página.
 *
 * Al terminar borra lo sembrado.
 *
 * Uso: node --env-file=.env scripts/e2e-bandeja-paginada.mjs
 * Requiere: app corriendo con el .env de pruebas (wa-mock) y Playwright, y
 * DATABASE_URL_MIGRATE (o DATABASE_URL) para sembrar.
 */
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString(36).slice(-5);
const N = 180;
const PN = "PN-E2E";
let failures = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "es-MX" });
const req = ctx.request;

console.log("== Setup ==");
let r = await req.post(`${BASE}/api/auth/sign-in/email`, {
  headers: { origin: BASE },
  data: { email: "e2e@vocero.test", password: "password-e2e-123" },
});
if (!r.ok())
  r = await req.post(`${BASE}/api/auth/sign-up/email`, {
    headers: { origin: BASE },
    data: { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" },
  });
ok("login", r.ok());
await req.put(`${BASE}/api/settings/whatsapp`, {
  headers: { origin: BASE },
  data: { wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" },
});

const dbUrl = process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL;
if (!dbUrl) throw new Error("Falta DATABASE_URL_MIGRATE (o DATABASE_URL) para sembrar.");
const sql = postgres(dbUrl, { max: 2 });
const [org] = await sql`select m.organization_id as id from member m join "user" u on u.id = m.user_id where u.email = 'e2e@vocero.test' limit 1`;
// 180 chats: «Pagina RUN g», del más reciente (g=1) al más viejo; uno de
// cada 4 con no leídos. Del último minuto: arriba de lo que ya hubiera en
// la Bandeja, y debajo de un mensaje que entre ahora.
const tels = new Map();
const serie = String(Date.now()).slice(-3);
for (let g = 1; g <= N; g++) tels.set(g, `57${serie}${String(g).padStart(7, "0")}`);
await sql`
  insert into contact (id, organization_id, name, wa_identity, phone)
  select 'ctpag_${sql.unsafe(RUN)}_' || g, ${org.id}, 'Pagina ${sql.unsafe(RUN)} ' || g, t, t
  from unnest(${[...tels.keys()]}::int[], ${[...tels.values()]}::text[]) as x(g, t)`;
await sql`
  insert into conversation (id, organization_id, contact_id, last_message_at, last_inbound_at, unread_count, created_at, updated_at)
  select 'cvpag_${sql.unsafe(RUN)}_' || g, ${org.id}, 'ctpag_${sql.unsafe(RUN)}_' || g,
         now() - (g || ' seconds')::interval, now() - (g || ' seconds')::interval,
         (g % 4 = 0)::int, now() - interval '30 days', now()
  from generate_series(1, ${N}::int) g`;
ok(`sembrados ${N} chats`, true);

const id = (g) => `cvpag_${RUN}_${g}`;
const fila = (g) => page.locator(`[data-conversation-row="${id(g)}"]`);
const listas = [];
const page = await ctx.newPage();
page.on("request", (rq) => {
  const u = new URL(rq.url());
  if (u.pathname === "/api/conversations" && rq.method() === "GET") listas.push(u.searchParams);
});
const paginas = [];
page.on("response", async (rs) => {
  const u = new URL(rs.url());
  if (u.pathname !== "/api/conversations" || !u.searchParams.get("limit")) return;
  const j = await rs.json().catch(() => null);
  if (j?.conversations)
    paginas.push({ cursor: u.searchParams.get("cursor"), next: j.nextCursor, ids: j.conversations.map((c) => c.id), status: u.searchParams.get("status") });
});

try {
  console.log("== Primera página ==");
  await page.goto(`${BASE}/inbox`);
  await fila(1).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  const completas = listas.filter((p) => !p.get("limit") && !p.get("ids") && !p.get("contactIds"));
  ok("no se pide la lista entera", completas.length === 0, `${completas.length}`);
  ok("se pide una página de 50", listas.some((p) => p.get("limit") === "50") && paginas.length === 1, `${paginas.length}`);
  const enDom = await page.locator("[data-conversation-row]").count();
  ok(`pocas filas en el DOM (${enDom})`, enDom > 0 && enDom <= 80);
  const cuenta = await req.get(`${BASE}/api/conversations/counts`).then((x) => x.json());
  ok(`el servidor cuenta todo (${cuenta.all} ≥ ${N})`, cuenta.all >= N);
  const capsula = (await page.getByRole("button", { name: /^Filtrar la bandeja/ }).getAttribute("aria-label")) ?? "";
  ok("«Todas» dice el total del servidor, no lo cargado", capsula.includes(`(${cuenta.all})`), capsula);

  console.log("== Bajar ==");
  const alFondo = () =>
    page.evaluate(() => {
      const caja = document.querySelector("[data-conversation-row]")?.closest("ul")?.parentElement;
      if (caja) caja.scrollTop = caja.scrollHeight;
    });
  for (let k = 0; k < 100 && paginas[paginas.length - 1]?.next; k++) {
    await alFondo();
    await page.waitForTimeout(150);
  }
  await alFondo();
  await page.waitForTimeout(400);
  const ultimaDelServidor = paginas[paginas.length - 1]?.ids.at(-1);
  const ultimaEnPantalla = await page.locator("[data-conversation-row]").last().getAttribute("data-conversation-row");
  ok("bajar trae las páginas siguientes hasta la última fila", !paginas.at(-1)?.next && ultimaEnPantalla === ultimaDelServidor, `${ultimaEnPantalla} / ${ultimaDelServidor}`);
  const vistos = paginas.flatMap((p) => p.ids);
  ok(`${paginas.length} páginas sin repetir filas`, paginas.length >= 4 && new Set(vistos).size === vistos.length);
  const nuestros = vistos.filter((v) => v.startsWith(`cvpag_${RUN}_`));
  ok("en orden: del más reciente al más viejo", nuestros.join() === Array.from({ length: N }, (_, i) => id(i + 1)).join());

  console.log("== Búsqueda y filtros en el servidor ==");
  await page.goto(`${BASE}/inbox`);
  await fila(1).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /buscar/i }).first().click().catch(() => {});
  const campo = page.getByRole("searchbox").or(page.getByPlaceholder(/buscar/i)).first();
  await campo.fill(`Pagina ${RUN} 170`);
  await fila(170).waitFor({ timeout: 10_000 }).catch(() => {});
  ok("la búsqueda encuentra el chat 170 (no estaba cargado)", (await fila(170).count()) === 1);
  ok("…y solo ese", (await page.locator("[data-conversation-row]").count()) === 1);
  await campo.fill("");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  await page.getByRole("button", { name: /^Filtrar la bandeja/ }).click();
  await page.getByRole("button", { name: /^No leídas/ }).click();
  await page.waitForTimeout(1200);
  const enCapsula = (await page.getByRole("button", { name: /^Filtrar la bandeja/ }).getAttribute("aria-label")) ?? "";
  ok("«No leídas» cuenta lo del servidor", enCapsula.includes(`(${cuenta.unread})`), enCapsula);
  const pedidaNoLeidas = paginas.some((p) => p.status === "unread");
  ok("«No leídas» se pide al servidor", pedidaNoLeidas);
  const noLeidas = await page.locator("[data-conversation-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-conversation-row")));
  const propias = noLeidas.filter((v) => v.startsWith(`cvpag_${RUN}_`)).map((v) => Number(v.split("_").pop()));
  ok("todas las filas de «No leídas» son no leídas", propias.length > 0 && propias.every((g) => g % 4 === 0), propias.slice(0, 8).join());

  console.log("== En vivo ==");
  await page.goto(`${BASE}/inbox`);
  await fila(1).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  ok("el chat 175 no está cargado al entrar", (await fila(175).count()) === 0);
  await req.post(`${BASE}/api/dev/wa-mock/inbound`, {
    headers: { origin: BASE },
    data: { phoneNumberId: PN, from: tels.get(175), name: `Pagina ${RUN} 175`, waMessageId: `wamid.pag.${RUN}.175`, text: "Hola desde abajo" },
  });
  await fila(175).waitFor({ timeout: 15_000 }).catch(() => {});
  const primera = await page.locator("[data-conversation-row]").first().getAttribute("data-conversation-row");
  ok("un mensaje al chat 175 lo sube a la cima sin recargar", primera === id(175), String(primera));

  console.log("== Enlace directo ==");
  await page.goto(`${BASE}/inbox?contact=ctpag_${RUN}_160`);
  const encabezado = page.locator("header p", { hasText: `Pagina ${RUN} 160` });
  await encabezado.first().waitFor({ timeout: 20_000 }).catch(() => {});
  ok("/inbox?contact=… abre el chat 160 (fuera de la primera página)", (await encabezado.count()) >= 1);
} finally {
  await sql`delete from contact where organization_id = ${org.id} and id like ${`ctpag\\_${RUN}\\_%`}`;
  await sql.end();
  await browser.close();
}
console.log(failures === 0 ? "\nOK" : `\n${failures} fallo(s)`);
process.exit(failures === 0 ? 0 : 1);
