/**
 * Self-test E2E de comportamiento — Onboarding guiado (2026-11; guion
 * tests/e2e/us-primeros-pasos.md).
 *
 * Una empresa recién dada de alta ve «Primeros pasos» con lo opcional sin
 * palomear (equipo, etapas/etiquetas, contactos). Al invitar a alguien, crear
 * una etiqueta y dar de alta un contacto, cada renglón se palomea solo. Con el
 * complemento «Conector de IA» aparece «Conecta ChatGPT o Claude», que lleva
 * primero a encender el conector. En el navegador: la guía en la Bandeja, «Tu
 * avance» y el tutorial del número nuevo en Tutoriales.
 *
 * Uso: node --env-file=.env scripts/e2e-primeros-pasos.mjs
 * Requiere: app corriendo con la BD migrada y el operador e2e@vocero.test.
 * Con SCREENSHOTS_DIR guarda capturas de cada pantalla.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const ADMIN = { email: "e2e@vocero.test", password: "password-e2e-123" };
const DUENO = { email: `dueno.pp.${RUN}@primeros.test`, name: `Dueña PP ${RUN}` };
const PASS = "contraseña-primeros-1";
const SHOTS = process.env.SCREENSHOTS_DIR ?? "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function ok(name, cond, extra = "") {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
const nid = (p) => `${p}_${randomBytes(12).toString("hex").slice(0, 20)}`;

const sql = postgres(process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL, { max: 2, onnotice: () => {} });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});

let ips = 0;
async function persona() {
  ips++;
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    deviceScaleFactor: SHOTS ? 2 : 1,
    extraHTTPHeaders: { "x-forwarded-for": `10.94.${Number(RUN.slice(-3)) % 256}.${ips}`, origin: BASE },
  });
  const call = async (method, path, body) => {
    const res = await ctx.request.fetch(`${BASE}${path}`, { method, data: body, failOnStatusCode: false, maxRedirects: 0, timeout: 180000 });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* no es JSON */
    }
    return { status: res.status(), json };
  };
  const entrar = async (email, password) => {
    let r;
    for (let i = 0; i < 10; i++) {
      r = await call("POST", "/api/auth/sign-in/email", { email, password });
      if (r.status !== 429) break;
      await new Promise((res) => setTimeout(res, 3000));
    }
    return r;
  };
  return { ctx, call, entrar };
}

const extra = (state, key) => state?.extras?.find((x) => x.key === key);
const shot = async (p, name) => {
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};

async function main() {
  console.log("== Una empresa nueva ==");
  const admin = await persona();
  ok("el operador inicia sesión", (await admin.entrar(ADMIN.email, ADMIN.password)).status < 400);

  const org = nid("org");
  await sql.begin(async (tx) => {
    await tx`insert into "organization" (id, name, slug, created_at) values (${org}, ${`Negocio PP ${RUN}`}, ${`pp-${RUN}`}, now())`;
    const etapas = [
      ["Nuevo", "open"],
      ["En conversación", "open"],
      ["Interesado", "open"],
      ["Cliente", "won"],
      ["Perdido", "lost"],
    ];
    for (const [i, [name, kind]] of etapas.entries()) {
      await tx`insert into "pipeline_stage" (id, organization_id, name, position, kind) values (${nid("stg")}, ${org}, ${name}, ${i}, ${kind})`;
    }
    await tx`insert into "agent_profile" (id, organization_id) values (${nid("agp")}, ${org})`;
  });
  const alta = await admin.call("POST", "/api/settings/team", { name: DUENO.name, email: DUENO.email, password: PASS, role: "coordinador" });
  ok("alta de la dueña", alta.status === 201, `status=${alta.status} ${JSON.stringify(alta.json)}`);
  await sql`update "member" set organization_id = ${org}, role = 'owner' where user_id = (select id from "user" where email = ${DUENO.email})`;

  const duena = await persona();
  ok("la dueña inicia sesión", (await duena.entrar(DUENO.email, PASS)).status < 400);

  let s = (await duena.call("GET", "/api/onboarding")).json;
  ok("la guía es para ella (Propietaria)", s?.canManage === true, JSON.stringify(s));
  ok(
    "lo opcional sin el conector: equipo, etapas y contactos",
    JSON.stringify(s?.extras?.map((x) => x.key)) === JSON.stringify(["team", "pipeline", "contacts"]),
    JSON.stringify(s?.extras),
  );
  ok("nada opcional palomeado todavía", s?.extras?.every((x) => !x.done), JSON.stringify(s?.extras));
  ok("lo opcional no cuenta en el avance (solo «Activa tu cuenta»)", s?.steps?.filter((x) => x.done).length === 1, JSON.stringify(s?.steps));

  console.log("\n== Cada renglón se palomea solo ==");
  const inv = await duena.call("POST", "/api/settings/team", { name: `Asesor PP ${RUN}`, email: `asesor.pp.${RUN}@primeros.test`, role: "asesor" });
  ok("invita a un asesor", inv.status === 201, `status=${inv.status} ${JSON.stringify(inv.json)}`);
  s = (await duena.call("GET", "/api/onboarding")).json;
  ok("«Invita a tu equipo» queda palomeado", extra(s, "team")?.done === true, JSON.stringify(s?.extras));
  ok("y lo demás sigue igual", extra(s, "pipeline")?.done === false && extra(s, "contacts")?.done === false);

  const tag = await duena.call("POST", "/api/contact-tags", { name: `Mayoreo ${RUN}`, color: "azul" });
  ok("crea una etiqueta", tag.status < 300, `status=${tag.status} ${JSON.stringify(tag.json)}`);
  s = (await duena.call("GET", "/api/onboarding")).json;
  ok("«Pon tus etapas y etiquetas» queda palomeado", extra(s, "pipeline")?.done === true, JSON.stringify(s?.extras));

  const ct = await duena.call("POST", "/api/contacts", { name: `Cliente PP ${RUN}`, phone: `52155${RUN.padStart(8, "0").slice(-8)}` });
  ok("da de alta un contacto", ct.status < 300, `status=${ct.status} ${JSON.stringify(ct.json)}`);
  s = (await duena.call("GET", "/api/onboarding")).json;
  ok("«Sube tus contactos» queda palomeado", extra(s, "contacts")?.done === true, JSON.stringify(s?.extras));

  console.log("\n== Con el complemento «Conector de IA» ==");
  await sql`insert into "organization_module" (organization_id, conector_ia) values (${org}, true)
            on conflict (organization_id) do update set conector_ia = true`;
  // Los módulos de una organización se guardan 5 s en memoria (server/modules/store.ts).
  await new Promise((r) => setTimeout(r, 6000));
  s = (await duena.call("GET", "/api/onboarding")).json;
  const ia = extra(s, "aiConnector");
  ok("aparece «Conecta ChatGPT o Claude»", !!ia && ia.done === false, JSON.stringify(s?.extras));
  ok("con el conector apagado lleva primero a encenderlo", ia?.href === "/settings/conector-ia", JSON.stringify(ia));
  ok("el estado avisa que la empresa tiene el complemento", s?.conectorIa === true);
  // Para las capturas: la guía como la ve una empresa que apenas empieza.
  await sql`delete from "contact_tag" where organization_id = ${org}`;
  await sql`update "contact" set archived_at = now() where organization_id = ${org}`;

  console.log("\n== En el navegador ==");
  const p = await duena.ctx.newPage();
  await p.goto(`${BASE}/inbox`, { timeout: 180000 });
  const card = p.locator("[data-onboarding]").first();
  await card.waitFor({ timeout: 60000 }).catch(() => {});
  ok("la Bandeja enseña «Primeros pasos»", await card.isVisible());
  ok("con su lista de lo opcional (4 renglones)", (await p.locator("[data-onboarding-extra]").count()) === 4);
  ok(
    "«Invita a tu equipo» se ve palomeado",
    (await p.locator('[data-onboarding-extra="team"]').getAttribute("data-done")) === "true",
  );
  ok("y ofrece «Ocultar guía»", await p.getByRole("button", { name: "Ocultar guía" }).isVisible());
  await shot(p, "1-bandeja-primeros-pasos");

  await p.goto(`${BASE}/ayuda`, { timeout: 180000 });
  await p.getByText("Tu avance").waitFor({ timeout: 60000 }).catch(() => {});
  ok("Tutoriales enseña «Tu avance»", await p.getByText("Tu avance").isVisible());
  ok("sin «Ocultar guía» ahí", (await p.getByRole("button", { name: "Ocultar guía" }).count()) === 0);
  ok("y el tutorial del número nuevo", await p.locator('[data-testid="tutorial-new-number"]').isVisible());
  ok("y el del conector de IA (la empresa lo tiene)", await p.locator('[data-testid="tutorial-ai-connector"]').isVisible());
  await p.locator('[data-testid="tutorial-new-number"] summary').click();
  const pasos = await p.locator('[data-testid="tutorial-new-number"] ol').innerText();
  ok("el tutorial dice a qué número llega el código", /código de 6 dígitos a ESE número nuevo/.test(pasos), pasos.slice(0, 200));
  await shot(p, "2-tutoriales-tu-avance");
  await p.locator('[data-testid="tutorial-new-number"]').scrollIntoViewIfNeeded();
  await shot(p, "3-tutorial-numero-nuevo");

  // Teléfono: la guía cabe sin desbordar.
  const movil = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: SHOTS ? 2 : 1,
    storageState: await duena.ctx.storageState(),
    extraHTTPHeaders: { "x-forwarded-for": `10.94.${Number(RUN.slice(-3)) % 256}.${ips + 1}`, origin: BASE },
  });
  const pm = await movil.newPage();
  await pm.goto(`${BASE}/ayuda`, { timeout: 180000 });
  await pm.getByText("Tu avance").waitFor({ timeout: 60000 }).catch(() => {});
  const ancho = await pm.evaluate(() => document.documentElement.scrollWidth);
  ok("en el teléfono no hay scroll de lado", ancho <= 390, `scrollWidth=${ancho}`);
  await shot(pm, "5-telefono-tu-avance");
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await browser.close();
  await sql.end();
}
console.log(failures ? `\n${failures} fallo(s)` : "\nTodo verde");
process.exit(failures ? 1 : 0);
