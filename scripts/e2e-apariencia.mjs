/**
 * Self-test E2E de la Fase D — Ajustes → Personalización → Apariencia.
 *
 *  1. Permisos: la API de apariencia de la organización solo la cambia quien
 *     administra (Asesor → 403); valores raros → 400; la marca no se pierde.
 *  2. Vista previa EN VIVO: al elegir una letra cambia el CRM entero (no solo
 *     un cuadro) y, si se sale sin guardar, vuelve la guardada.
 *  3. Dos niveles: lo de la organización lo ve todo el equipo; lo personal
 *     (cookie de este navegador) lo pisa solo para esa persona.
 *  4. Estilo del chat: «WhatsApp» (cola, fondo, color) frente a «Clásico».
 *  5. Ninguna petición a Google Fonts.
 *  6. Marca y Navegación viven dentro de Personalización (rutas viejas
 *     redirigen); el Asesor no entra a Marca.
 *
 * Uso: app viva con los mocks (corre antes pnpm test:e2e o cualquier guion
 * que cree e2e@vocero.test).  node --env-file=.env scripts/e2e-apariencia.mjs
 * Re-ejecutable. Sale con 1 si algo falla.
 */
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const ADMIN = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
const ASESOR = { email: `asesor.ap.${RUN}@apariencia.test`, name: `Asesor Ap ${RUN}` };
const PASS = "contraseña-de-apariencia-1";

let failures = 0;
function ok(name, cond, extra = "") {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

const sql = postgres(process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL, { max: 2, onnotice: () => {} });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});

let ips = 0;
async function persona() {
  ips++;
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { "x-forwarded-for": `10.93.${Number(RUN.slice(-3)) % 256}.${ips}`, origin: BASE },
  });
  const call = async (method, path, body) => {
    const res = await ctx.request.fetch(`${BASE}${path}`, { method, data: body, failOnStatusCode: false, maxRedirects: 0, timeout: 180000 });
    let json = null;
    try { json = await res.json(); } catch { /* no es JSON */ }
    return { status: res.status(), json };
  };
  const pagina = async (path) => {
    const p = await ctx.newPage();
    const r = await p.goto(`${BASE}${path}`, { timeout: 180000 });
    return { p, status: r?.status() ?? 0 };
  };
  return { ctx, call, pagina, entrar: (email, password) => call("POST", "/api/auth/sign-in/email", { email, password }) };
}
const html = (p, attr) => p.evaluate((a) => document.documentElement.getAttribute(a), attr);
const fuente = (p) => p.evaluate(() => getComputedStyle(document.body).fontFamily);
const cookie = async (ctx, name) => (await ctx.cookies()).find((c) => c.name === name)?.value;

async function main() {
  console.log("== Setup ==");
  const O = await persona();
  let login = await O.entrar(ADMIN.email, ADMIN.password);
  if (login.status >= 400) {
    await O.call("POST", "/api/auth/sign-up/email", ADMIN);
    login = await O.entrar(ADMIN.email, ADMIN.password);
  }
  ok("la Propietaria entra", login.status < 400, String(login.status));
  const alta = await O.call("POST", "/api/settings/team", { name: ASESOR.name, email: ASESOR.email, password: PASS, role: "asesor" });
  ok("alta del Asesor", alta.status === 201, JSON.stringify(alta.json));
  const S = await persona();
  ok("el Asesor entra", (await S.entrar(ASESOR.email, PASS)).status < 400);
  const [{ organization_id: org } = {}] = await sql`
    select m.organization_id from member m join "user" u on u.id = m.user_id where u.email = ${ADMIN.email}`;

  // La marca y la apariencia comparten organization.metadata: guardar la una no debe borrar la otra.
  const marcaPut = await O.call("PUT", "/api/settings/branding", { name: `Marca Ap ${RUN}`, accent: "#12999d", currency: "MXN" });
  ok("la marca se guarda", marcaPut.status === 200, String(marcaPut.status));
  const marcaAntes = (await O.call("GET", "/api/settings/branding")).json?.branding?.name;

  console.log("\n== 1 · Permisos de la API ==");
  ok("el Asesor no cambia la de la organización (403)", (await S.call("PUT", "/api/settings/appearance", { font: "geist" })).status === 403);
  const malo = await O.call("PUT", "/api/settings/appearance", { font: "comic-sans" });
  ok("una letra desconocida → 422", malo.status === 422, String(malo.status));
  ok("un cuerpo vacío → 422", (await O.call("PUT", "/api/settings/appearance", {})).status === 422);
  const bien = await O.call("PUT", "/api/settings/appearance", { font: "geist", chatStyle: "whatsapp" });
  ok("la Propietaria guarda letra y estilo (200)", bien.status === 200 && bien.json?.appearance?.font === "geist", JSON.stringify(bien.json));
  const [{ metadata }] = await sql`select metadata from organization where id = ${org}`;
  ok("queda en organization.metadata junto a la marca (sin migración)", JSON.parse(metadata).appearance?.font === "geist" && !!JSON.parse(metadata).branding);
  ok("la marca no se perdió", (await O.call("GET", "/api/settings/branding")).json?.branding?.name === marcaAntes);

  console.log("\n== 2 · Vista previa en vivo y volver sin guardar ==");
  const googleReqs = [];
  O.ctx.on("request", (r) => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) googleReqs.push(r.url()); });
  const ap = await O.pagina("/settings/personalization");
  ok("la pantalla abre (200)", ap.status === 200, String(ap.status));
  ok("arranca con la letra de la organización (Geist)", (await html(ap.p, "data-font")) === "geist");
  ok("las cuatro letras están en la lista", (await ap.p.getByRole("radio", { name: /^(Inter|Geist|Plus Jakarta Sans|DM Sans)$/ }).count()) === 4);
  await ap.p.getByRole("radio", { name: "DM Sans" }).click();
  ok("al elegir DM Sans cambia TODO el CRM antes de guardar", (await html(ap.p, "data-font")) === "dmsans" && /DM Sans/.test(await fuente(ap.p)), await fuente(ap.p));
  await ap.p.getByRole("radio", { name: "Plus Jakarta Sans" }).click();
  ok("…y con Plus Jakarta Sans también", /Plus Jakarta Sans/.test(await fuente(ap.p)), await fuente(ap.p));
  await ap.p.getByRole("radio", { name: "Inter" }).click();
  ok("…y con Inter (la de fábrica)", /inter/i.test(await fuente(ap.p)), await fuente(ap.p));
  await ap.p.getByRole("link", { name: "WhatsApp" }).first().click();
  await ap.p.waitForURL(/settings\/whatsapp/);
  let volvio = false;
  for (let i = 0; i < 20 && !volvio; i++) {
    volvio = (await html(ap.p, "data-font")) === "geist";
    if (!volvio) await new Promise((r) => setTimeout(r, 250));
  }
  ok("sin guardar y al salir, vuelve la guardada (Geist)", volvio, await html(ap.p, "data-font"));
  ok("nada se guardó por probar", (await cookie(O.ctx, "vocero-font")) === undefined);

  console.log("\n== 3 · Dos niveles ==");
  await ap.p.goto(`${BASE}/settings/personalization`);
  ok("la Propietaria ve «Para mí» y «Toda la organización»", (await ap.p.getByRole("tab").count()) >= 2);
  await ap.p.getByRole("radio", { name: "DM Sans" }).click();
  await ap.p.getByRole("button", { name: "Guardar para mí" }).click();
  await ap.p.getByText("solo en este navegador").first().waitFor();
  ok("lo personal es una cookie de este navegador", (await cookie(O.ctx, "vocero-font")) === "dmsans");
  await ap.p.reload();
  ok("al recargar, ya llega pintada (sin parpadeo)", (await html(ap.p, "data-font")) === "dmsans");
  const [{ metadata: m2 }] = await sql`select metadata from organization where id = ${org}`;
  ok("la de la organización no cambió (sigue Geist)", JSON.parse(m2).appearance?.font === "geist");

  const sa = await S.pagina("/settings/personalization");
  ok("el Asesor abre Apariencia (200)", sa.status === 200, String(sa.status));
  ok("el Asesor ve la de la organización (Geist)", (await html(sa.p, "data-font")) === "geist");
  ok("el Asesor NO ve el nivel «Toda la organización»", (await sa.p.getByRole("tab", { name: "Toda la organización" }).count()) === 0);
  await sa.p.getByRole("radio", { name: "Plus Jakarta Sans" }).click();
  await sa.p.getByRole("button", { name: "Guardar para mí" }).click();
  await sa.p.getByText("solo en este navegador").first().waitFor();
  await sa.p.reload();
  ok("el Asesor cambia solo su vista (Plus Jakarta Sans)", (await html(sa.p, "data-font")) === "jakarta");
  const otra = await persona();
  await otra.entrar(ASESOR.email, PASS);
  const op = await otra.pagina("/settings/personalization");
  ok("otro navegador del mismo Asesor sigue viendo la de la organización", (await html(op.p, "data-font")) === "geist");
  await sa.p.getByRole("button", { name: "Usar la de la organización" }).click();
  ok("«Usar la de la organización» quita su cookie", (await html(sa.p, "data-font")) === "geist" && (await cookie(S.ctx, "vocero-font")) === undefined);

  console.log("\n== 4 · Estilo del chat ==");
  const antes = await ap.p.goto(`${BASE}/settings/personalization`);
  void antes;
  await ap.p.getByRole("radio", { name: /^Clásico/ }).click();
  const cola = (q) => ap.p.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? getComputedStyle(el, "::before").content : null;
  }, q);
  ok("Clásico: las burbujas no llevan cola", (await cola("[data-testid=chat-preview] .bubble-first")) === "none");
  const fondoClasico = await ap.p.evaluate(() => getComputedStyle(document.querySelector("[data-testid=chat-preview]")).backgroundColor);
  await ap.p.getByRole("radio", { name: /^WhatsApp/ }).click();
  ok("WhatsApp: la burbuja del primer mensaje lleva cola", (await cola("[data-testid=chat-preview] .bubble-first")) === '""');
  const fondoWa = await ap.p.evaluate(() => getComputedStyle(document.querySelector("[data-testid=chat-preview]")).backgroundColor);
  ok("WhatsApp: el fondo cambia (verde/gris)", fondoWa !== fondoClasico, `${fondoClasico} → ${fondoWa}`);
  const colorOut = await ap.p.evaluate(() => getComputedStyle(document.querySelector("[data-testid=chat-preview] .bubble-out")).backgroundColor);
  ok("WhatsApp: la burbuja saliente es verde claro", colorOut === "rgb(217, 253, 211)", colorOut);
  ok("la vista previa tiene mensajes de ejemplo", (await ap.p.locator("[data-testid=chat-preview] .bubble").count()) === 4);
  ok("la hora va en la burbuja (abajo a la derecha)", (await ap.p.locator("[data-testid=chat-preview] .bubble .float-right").count()) === 4);
  await ap.p.getByRole("tab", { name: "Toda la organización" }).click();
  await ap.p.getByRole("radio", { name: /^Clásico/ }).click();
  await ap.p.getByRole("button", { name: "Guardar para todos" }).click();
  await ap.p.getByText("Toda la organización lo verá así").waitFor();
  const [{ metadata: m3 }] = await sql`select metadata from organization where id = ${org}`;
  ok("guardar «Clásico» para todos queda en la organización", JSON.parse(m3).appearance?.chatStyle === "classic");
  const sb = await S.pagina("/inbox");
  ok("el Asesor ve la Bandeja con el estilo de la organización", (await html(sb.p, "data-chat")) === "classic");
  await O.call("PUT", "/api/settings/appearance", { font: "inter", chatStyle: "classic" });

  console.log("\n== 5 · Sin Google Fonts ==");
  ok("ninguna petición a fonts.googleapis.com / gstatic.com", googleReqs.length === 0, googleReqs.join());

  console.log("\n== 6 · Marca y Navegación dentro de Personalización ==");
  const marca = await O.pagina("/settings/branding");
  ok("/settings/branding redirige a Personalización → Marca", new URL(marca.p.url()).pathname === "/settings/personalization/marca", marca.p.url());
  const formulario = await marca.p.getByText("Moneda del negocio").waitFor({ timeout: 30000 }).then(() => true, () => false);
  ok("Marca sigue con su formulario", formulario);
  const nav = await O.pagina("/settings/navigation");
  ok("/settings/navigation redirige a Personalización → Navegación", new URL(nav.p.url()).pathname === "/settings/personalization/navegacion", nav.p.url());
  const asMarca = await S.pagina("/settings/personalization/marca");
  ok("el Asesor no entra a Marca (vuelve a la Bandeja)", new URL(asMarca.p.url()).pathname === "/inbox", asMarca.p.url());
}

try {
  await main();
} catch (e) {
  failures++;
  console.error(e);
} finally {
  await browser.close();
  await sql.end();
}
console.log(failures ? `\n${failures} FALLA(S)` : "\nTodo verde");
process.exit(failures ? 1 : 0);
