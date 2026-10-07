/**
 * Self-test E2E de Campañas v2, PR 4 — módulos y navegación personalizable
 * (tests/e2e/us-navegacion.md). Contra la app real con mocks:
 *
 *  1. Alta con perfil: «Completo» enciende todo y el menú personalizable;
 *     «Básico» deja fuera Agente, Laboratorio y Campañas. Laboratorio
 *     requiere Agente.
 *  2. Sin `custom_nav` la pestaña Ajustes → Navegación no existe (404 en API
 *     y página); Coordinador y Asesor reciben 403 aunque esté encendido.
 *  3. La Propietaria, en el navegador: reordena el menú del Asesor con el
 *     TECLADO (manija + flechas) y con los botones ↑, oculta «Chat de
 *     equipo», ve la vista previa y guarda. No puede ocultarse Ajustes ni
 *     dejar a un rol sin nada.
 *  4. El Asesor ve su menú nuevo en los tres estados (expandido, íconos,
 *     oculto → cajón del teléfono); lo oculto sigue respondiendo (solo
 *     estético) y lo que no tiene permiso sigue en 403. El Coordinador no
 *     cambia.
 *  5. Un módulo apagado por la plataforma no aparece ni responde, aunque el
 *     menú guardado lo muestre.
 *  6. «Restaurar valores por defecto» desde la interfaz, con bitácora.
 *  7. Aislamiento: otra organización no ve ni hereda nada.
 *
 * Uso: app viva con WA_MOCK_ENABLED=true, los mocks y PLATFORM_ORG_ID = la
 * organización de e2e@vocero.test (corre antes pnpm test:e2e).
 *   node --env-file=.env scripts/e2e-navegacion.mjs
 * Re-ejecutable (cada corrida crea sus propias organizaciones). Sale con 1 si
 * algo falla.
 */
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const ADMIN = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
const OWNER = { email: `duena.nav.${RUN}@navegacion.test`, name: `Dueña Nav ${RUN}` };
const COORD = { email: `coord.nav.${RUN}@navegacion.test`, name: `Coordinadora Nav ${RUN}` };
const ASESOR = { email: `asesor.nav.${RUN}@navegacion.test`, name: `Asesor Nav ${RUN}` };
const PASS = "contraseña-de-navegacion-1";
const CACHE_MS = 5500; // la caché de módulos dura 5 s por proceso

let failures = 0;
let checks = 0;
const fallas = [];
function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    fallas.push(name);
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 15000) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(300);
  }
}

const sql = postgres(process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL, { max: 2, onnotice: () => {} });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});

let ips = 0;
/** Una persona: su propio navegador (cookies) y su propia IP (límite de login). */
async function persona(viewport = { width: 1366, height: 900 }) {
  ips++;
  const ctx = await browser.newContext({
    viewport,
    extraHTTPHeaders: { "x-forwarded-for": `10.91.${Number(RUN.slice(-3)) % 256}.${ips}`, origin: BASE },
  });
  const call = async (method, path, body) => {
    const res = await ctx.request.fetch(`${BASE}${path}`, { method, data: body, failOnStatusCode: false, maxRedirects: 0, timeout: 180000 });
    let json = null;
    try {
      json = await res.json();
    } catch {
      // no es JSON
    }
    return { status: res.status(), json };
  };
  const entrar = async (email, password) => await call("POST", "/api/auth/sign-in/email", { email, password });
  const pagina = async (path) => {
    const p = await ctx.newPage();
    const r = await p.goto(`${BASE}${path}`, { timeout: 180000 });
    return { p, status: r?.status() ?? 0 };
  };
  return { ctx, call, entrar, pagina };
}

/** Los renglones del menú lateral, en orden (sin Ajustes ni Plataforma). */
async function menu(p) {
  const nav = p.locator("aside nav").first();
  await nav.waitFor({ state: "attached", timeout: 60000 });
  return (await nav.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("title") ?? a.textContent?.trim() ?? ""))).filter(Boolean);
}

async function alta(A, name, owner, profile) {
  const r = await A.call("POST", "/api/platform/organizations", { name, ownerName: owner.name, ownerEmail: owner.email, profile });
  const token = String(r.json?.activationUrl ?? "").split("/").pop();
  const act = await A.call("POST", `/api/account-link/${token}`, { password: PASS });
  return { status: r.status, orgId: r.json?.organizationId, activated: act.status === 200 };
}

async function main() {
  const A = await persona();
  console.log("== Setup ==");
  let login = await A.entrar(ADMIN.email, ADMIN.password);
  if (login.status >= 400) {
    await A.call("POST", "/api/auth/sign-up/email", ADMIN);
    login = await A.entrar(ADMIN.email, ADMIN.password);
  }
  ok("el operador entra", login.status < 400, String(login.status));
  const [{ organization_id: orgA } = {}] = await sql`
    select m.organization_id from member m join "user" u on u.id = m.user_id where u.email = ${ADMIN.email}`;
  ok("PLATFORM_ORG_ID es la organización del operador", process.env.PLATFORM_ORG_ID === orgA, `${process.env.PLATFORM_ORG_ID} vs ${orgA}`);
  execFileSync("node", ["scripts/platform-admin.mjs", "add", "--email", ADMIN.email, "--apply"], { env: process.env, encoding: "utf8" });
  await sql`update platform_admin set failed_reauth = 0, locked_until = null where user_id = (select id from "user" where email = ${ADMIN.email})`;

  console.log("\n== 1 · Alta con perfil y dependencia Laboratorio → Agente ==");
  const N = await alta(A, `Negocio Nav ${RUN}`, OWNER, "completo");
  ok("alta con perfil Completo (201) y activación", N.status === 201 && N.activated, JSON.stringify(N));
  const [modN] = await sql`select * from organization_module where organization_id = ${N.orgId}`;
  ok(
    "Completo: todo encendido y menú personalizable",
    modN?.campaigns && modN?.agenda && modN?.agent && modN?.lab && modN?.knowledge && modN?.team_chat && modN?.results && modN?.custom_nav,
    JSON.stringify(modN)
  );
  const OWNER_M = { email: `duena.basico.${RUN}@navegacion.test`, name: `Dueña Básico ${RUN}` };
  const M = await alta(A, `Negocio Básico ${RUN}`, OWNER_M, "basico");
  const [modM] = await sql`select * from organization_module where organization_id = ${M.orgId}`;
  ok(
    "Básico: sin Agente, Laboratorio, Campañas ni menú personalizable; con Conocimientos y Chat",
    modM && !modM.agent && !modM.lab && !modM.campaigns && !modM.custom_nav && modM.knowledge && modM.team_chat,
    JSON.stringify(modM)
  );
  const labSolo = await A.call("POST", `/api/platform/organizations/${M.orgId}/modules`, { lab: true });
  ok("encender el Laboratorio sin Agente → 422", labSolo.status === 422, JSON.stringify(labSolo.json));
  const malo = await A.call("POST", "/api/platform/organizations", { name: "x perfil", ownerName: "x", ownerEmail: `x.${RUN}@nav.test`, profile: "gigante" });
  ok("un perfil desconocido → 400/422", malo.status === 400 || malo.status === 422, String(malo.status));

  const O = await persona();
  ok("la Propietaria entra", (await O.entrar(OWNER.email, PASS)).status < 400);
  for (const [p, role] of [[COORD, "coordinador"], [ASESOR, "asesor"]]) {
    const r = await O.call("POST", "/api/settings/team", { name: p.name, email: p.email, password: PASS, role });
    ok(`alta de ${role}`, r.status === 201, JSON.stringify(r.json));
  }
  const C = await persona();
  const S = await persona();
  ok("la Coordinadora entra", (await C.entrar(COORD.email, PASS)).status < 400);
  ok("el Asesor entra", (await S.entrar(ASESOR.email, PASS)).status < 400);

  console.log("\n== 2 · Sin custom_nav no existe; los demás roles, 403 ==");
  await A.call("POST", `/api/platform/organizations/${N.orgId}/modules`, { customNav: false });
  await sleep(CACHE_MS);
  ok("API 404 sin custom_nav", (await O.call("GET", "/api/settings/navigation")).status === 404);
  // Fase D: la pantalla vive en Ajustes → Personalización → Navegación y, sin
  // el módulo, explica por qué no está disponible (no desaparece ni da 404).
  const pagOff = await O.pagina("/settings/navigation");
  ok("la ruta vieja redirige a Personalización → Navegación", new URL(pagOff.p.url()).pathname === "/settings/personalization/navegacion", pagOff.p.url());
  ok("página 200 con el aviso de por qué no está disponible", pagOff.status === 200 && (await pagOff.p.getByText("Disponible cuando el módulo «Menú personalizable» está encendido").count()) === 1, String(pagOff.status));
  ok("sin custom_nav no hay editor de menú", (await pagOff.p.locator("li[data-nav-key]").count()) === 0);
  await pagOff.p.goto(`${BASE}/settings/whatsapp`);
  ok("Ajustes tiene una sola pestaña «Personalización» (Marca y Navegación van dentro)", (await pagOff.p.getByRole("link", { name: "Personalización" }).count()) === 1 && (await pagOff.p.getByRole("link", { name: "Navegación" }).count()) === 0);
  await pagOff.p.close();
  await A.call("POST", `/api/platform/organizations/${N.orgId}/modules`, { customNav: true });
  await sleep(CACHE_MS);
  ok("con custom_nav, la Propietaria la abre (200)", (await O.call("GET", "/api/settings/navigation")).status === 200);
  ok("la Coordinadora recibe 403", (await C.call("GET", "/api/settings/navigation")).status === 403);
  ok("el Asesor recibe 403", (await S.call("PUT", "/api/settings/navigation", { role: "asesor", items: [{ key: "inbox", hidden: false }] })).status === 403);
  const asesorAntes = await S.pagina("/inbox");
  const menuAntes = await menu(asesorAntes.p);
  ok("el Asesor arranca con el menú de fábrica", menuAntes[0] === "Bandeja" && menuAntes.includes("Chat de equipo"), menuAntes.join());
  await asesorAntes.p.close();

  console.log("\n== 3 · La Propietaria edita el menú del Asesor (navegador) ==");
  const ed = await O.pagina("/settings/navigation");
  ok("la pestaña «Navegación» aparece en Ajustes", (await ed.p.getByRole("link", { name: "Navegación" }).count()) > 0);
  await ed.p.getByRole("tab", { name: /Asesor/ }).click();
  const filas = ed.p.locator("li[data-nav-key]");
  await filas.first().waitFor({ timeout: 30000 });
  const orden = async () => await filas.evaluateAll((ls) => ls.map((l) => l.getAttribute("data-nav-key")));
  const inicial = await orden();
  ok("lista con el orden de fábrica", inicial[0] === "inbox" && inicial.at(-1) === "settings", inicial.join());
  // Teclado: manija de Contactos → Espacio → ↑ ×4 → Espacio (dnd-kit).
  const posContactos = inicial.indexOf("contacts");
  const manija = ed.p.getByRole("button", { name: /^Mover Contactos/ });
  await manija.focus();
  await ed.p.keyboard.press("Space");
  await sleep(150);
  for (let i = 0; i < posContactos; i++) {
    await ed.p.keyboard.press("ArrowUp");
    await sleep(150);
  }
  await ed.p.keyboard.press("Space");
  ok("con el teclado, Contactos sube al primer lugar", await hasta(async () => (await orden())[0] === "contacts"), (await orden()).join());
  // Botones ↑ ↓: Pipeline sube uno.
  const antesPipe = (await orden()).indexOf("pipeline");
  await ed.p.getByRole("button", { name: "Subir Pipeline" }).click();
  ok("con el botón ↑, Pipeline sube un lugar", (await orden()).indexOf("pipeline") === antesPipe - 1, (await orden()).join());
  await ed.p.getByRole("switch", { name: "Chat de equipo visible" }).click();
  const preview = ed.p.getByRole("region", { name: /Vista previa/ });
  const previa = async () => await preview.locator("[data-preview-key]").evaluateAll((es) => es.map((e) => e.getAttribute("data-preview-key")));
  ok("la vista previa ya no muestra «Chat de equipo»", await hasta(async () => !(await previa()).includes("team_chat")), (await previa()).join());
  ok("…y empieza por Contactos", (await previa())[0] === "contacts", (await previa()).join());
  ok("Resultados aparece como no disponible para el Asesor", (await ed.p.locator('li[data-nav-key="results"]').innerText()).includes("no puede abrirlo"));
  await ed.p.getByRole("button", { name: "Guardar" }).click();
  ok("guardado", await hasta(async () => (await ed.p.getByText(/guardado/).count()) > 0));
  const [fila] = await sql`select items from nav_layout where organization_id = ${N.orgId} and role = 'asesor'`;
  const guardado = fila?.items ?? [];
  ok(
    "la fila de nav_layout del Asesor tiene el orden y lo oculto",
    guardado[0]?.key === "contacts" && guardado.find((i) => i.key === "team_chat")?.hidden === true,
    JSON.stringify(guardado).slice(0, 200)
  );
  // Reglas: Propietario sin Ajustes, y un rol sin nada.
  await ed.p.getByRole("tab", { name: /Propietario/ }).click();
  const swAjustes = ed.p.getByRole("switch", { name: "Ajustes visible" });
  await swAjustes.waitFor({ timeout: 15000 });
  ok("al Propietario, el interruptor de Ajustes está bloqueado", await swAjustes.isDisabled());
  const items = (await O.call("GET", "/api/settings/navigation")).json?.roles?.owner?.items ?? [];
  const sinAjustes = await O.call("PUT", "/api/settings/navigation", {
    role: "owner",
    items: items.map((i) => (i.key === "settings" ? { ...i, hidden: true } : i)),
  });
  ok("API: el Propietario no puede ocultarse Ajustes (422)", sinAjustes.status === 422, JSON.stringify(sinAjustes.json));
  const vacio = await O.call("PUT", "/api/settings/navigation", {
    role: "asesor",
    items: guardado.map((i) => ({ ...i, hidden: true })),
  });
  ok("API: el Asesor no puede quedarse sin nada (422)", vacio.status === 422 && vacio.json?.error?.code === "empty", JSON.stringify(vacio.json));
  await ed.p.getByRole("tab", { name: /Coordinador/ }).click();
  for (const sw of await ed.p.getByRole("switch").all()) if ((await sw.getAttribute("aria-checked")) === "true" && !(await sw.isDisabled())) await sw.click();
  ok("en la interfaz, todo oculto avisa y no deja guardar", (await ed.p.getByRole("alert").filter({ hasText: "al menos una" }).count()) > 0 && (await ed.p.getByRole("button", { name: "Guardar" }).isDisabled()));
  await ed.p.getByRole("button", { name: "Descartar cambios" }).click();
  await ed.p.close();

  console.log("\n== 4 · Lo que ve cada rol (tres estados del menú y móvil) ==");
  const modos = {};
  for (const modo of ["expanded", "collapsed"]) {
    await S.call("PUT", "/api/preferences", { navMode: modo });
    const v = await S.pagina("/inbox");
    modos[modo] = await menu(v.p);
    await v.p.close();
  }
  ok("expandido: empieza por Contactos y no tiene «Chat de equipo»", modos.expanded[0] === "Contactos" && !modos.expanded.includes("Chat de equipo"), modos.expanded.join());
  ok("en íconos: el mismo orden", modos.collapsed.join() === modos.expanded.join(), modos.collapsed.join());
  await S.call("PUT", "/api/preferences", { navMode: "hidden" });
  const tel = await persona({ width: 390, height: 844 });
  await tel.entrar(ASESOR.email, PASS);
  const vt = await tel.pagina("/inbox");
  await vt.p.getByRole("button", { name: "Abrir el menú" }).click();
  const enTel = await menu(vt.p);
  ok("oculto en escritorio → en el teléfono el cajón tiene el mismo menú", enTel.join() === modos.expanded.join(), enTel.join());
  await vt.p.close();
  await S.call("PUT", "/api/preferences", { navMode: null });
  ok("oculto ≠ prohibido: el Asesor sigue abriendo el chat de equipo (API 200)", (await S.call("GET", "/api/team-chat/threads")).status === 200);
  const chat = await S.pagina("/chat");
  ok("…y la página /chat (200)", chat.status === 200, String(chat.status));
  await chat.p.close();
  ok("sin permiso sigue en 403 (Resultados)", (await S.call("GET", "/api/analytics/sales?from=2026-01-01&to=2026-01-31")).status === 403);
  const coordMenu = await C.pagina("/inbox");
  const mc = await menu(coordMenu.p);
  ok("la Coordinadora no cambia (Bandeja primero, con Chat de equipo)", mc[0] === "Bandeja" && mc.includes("Chat de equipo"), mc.join());
  await coordMenu.p.close();

  console.log("\n== 5 · Módulo apagado por la plataforma ==");
  await A.call("POST", `/api/platform/organizations/${N.orgId}/modules`, { knowledge: false });
  await sleep(CACHE_MS);
  const sinK = await S.pagina("/inbox");
  const ms = await menu(sinK.p);
  ok("el menú del Asesor ya no tiene Conocimientos (aunque lo guardado lo muestra)", !ms.includes("Conocimientos"), ms.join());
  await sinK.p.close();
  ok("y la API responde 404", (await S.call("GET", "/api/knowledge")).status === 404);
  const editorK = (await O.call("GET", "/api/settings/navigation")).json;
  ok("el editor lo marca como no disponible", !(editorK?.roles?.asesor?.available ?? []).includes("knowledge"));
  await A.call("POST", `/api/platform/organizations/${N.orgId}/modules`, { knowledge: true });
  await sleep(CACHE_MS);
  ok("encendido otra vez, responde (200)", (await S.call("GET", "/api/knowledge")).status === 200);

  console.log("\n== 6 · Restaurar valores por defecto (interfaz) ==");
  const rs = await O.pagina("/settings/navigation");
  await rs.p.getByRole("tab", { name: /Asesor/ }).click();
  rs.p.once("dialog", (d) => void d.accept());
  await rs.p.getByRole("button", { name: "Restaurar valores por defecto" }).click();
  ok("restaurado", await hasta(async () => (await rs.p.getByText(/restaurado/).count()) > 0));
  ok("la bitácora lo muestra", await hasta(async () => (await rs.p.getByText(/restauró el menú de Asesor/).count()) > 0));
  await rs.p.close();
  ok("ya no hay fila del Asesor", (await sql`select 1 from nav_layout where organization_id = ${N.orgId} and role = 'asesor'`).length === 0);
  const eventos = await sql`select action from nav_layout_event where organization_id = ${N.orgId} and role = 'asesor' order by at`;
  ok("bitácora: guardado y restaurado", eventos.map((e) => e.action).join() === "saved,reset", eventos.map((e) => e.action).join());
  const vuelta = await S.pagina("/inbox");
  const mv = await menu(vuelta.p);
  ok("el Asesor vuelve al menú de fábrica", mv[0] === "Bandeja" && mv.includes("Chat de equipo"), mv.join());
  await vuelta.p.close();

  console.log("\n== 7 · Aislamiento entre organizaciones ==");
  await O.call("PUT", "/api/settings/navigation", { role: "asesor", items: guardado });
  ok("la organización del operador (sin custom_nav) → 404", (await A.call("GET", "/api/settings/navigation")).status === 404);
  await A.call("POST", `/api/platform/organizations/${orgA}/modules`, { customNav: true });
  await sleep(CACHE_MS);
  const deA = (await A.call("GET", "/api/settings/navigation")).json;
  ok(
    "con custom_nav, A no ve el menú ni la bitácora de N",
    deA?.roles?.asesor?.customized === false && !(deA?.events ?? []).some((e) => e.actorName === OWNER.name),
    JSON.stringify(deA?.events ?? []).slice(0, 200)
  );
  await A.call("POST", `/api/platform/organizations/${orgA}/modules`, { customNav: false });

  console.log("\n== 8 · Plantillas: en Campañas si está encendido; si no, en Ajustes ==");
  const tpl = await O.pagina("/settings/templates");
  ok("con Campañas, /settings/templates redirige a /campaigns/templates", new URL(tpl.p.url()).pathname === "/campaigns/templates", tpl.p.url());
  const tabs = tpl.p.getByRole("navigation", { name: "Secciones de Campañas" });
  ok("la pestaña «Plantillas» está junto a Campañas, Audiencias y Métricas", (await tabs.getByRole("link", { name: "Plantillas" }).count()) === 1);
  ok("con el flujo de plantillas (lista)", await hasta(async () => (await tpl.p.getByTestId("template-list").count()) > 0));
  await tpl.p.goto(`${BASE}/settings/team`);
  ok("Ajustes ya no muestra la pestaña «Plantillas»", (await tpl.p.getByRole("link", { name: "Plantillas", exact: true }).count()) === 0);
  await tpl.p.close();
  const tplAsesor = await S.pagina("/campaigns/templates");
  ok("el Asesor no entra a Campañas → Plantillas (vuelve a la Bandeja)", new URL(tplAsesor.p.url()).pathname === "/inbox", tplAsesor.p.url());
  await tplAsesor.p.close();
  const MB = await persona();
  ok("la Propietaria del negocio Básico entra", (await MB.entrar(OWNER_M.email, PASS)).status < 400);
  const tplM = await MB.pagina("/settings/templates");
  ok("sin Campañas, Ajustes → Plantillas sigue como hoy (200, sin redirigir)", tplM.status === 200 && new URL(tplM.p.url()).pathname === "/settings/templates", `${tplM.status} ${tplM.p.url()}`);
  ok("…con su pestaña en Ajustes", (await tplM.p.getByRole("link", { name: "Plantillas", exact: true }).count()) > 0);
  await tplM.p.close();
  const camM = await MB.pagina("/campaigns/templates");
  ok("y /campaigns/templates no existe para ella (404)", camM.status === 404, String(camM.status));
  await camM.p.close();
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

console.log(`\n${checks - failures}/${checks} checks OK${failures ? `, ${failures} fallos` : ""}`);
if (fallas.length) console.log(`Fallaron:\n - ${fallas.join("\n - ")}`);
process.exit(failures ? 1 : 0);
