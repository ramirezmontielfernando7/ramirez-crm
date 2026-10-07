/**
 * Self-test E2E de 033, PR 1 — «Trabajo»: Citas + Tareas
 * (tests/e2e/us-trabajo.md). Contra la app real con mocks:
 *
 *  1. Menú: un solo ítem «Trabajo» (ya no «Citas»), que abre Citas en la
 *     LISTA con las pestañas Citas y Tareas.
 *  2. La Asesora, en el navegador: alta rápida (escribe y Enter), marca hecha
 *     de un toque y la encuentra en «Hechas».
 *  3. Desde un chat de la Bandeja: «Nueva tarea para este chat» → la tarea
 *     queda ligada y «Abrir chat» vuelve a esa conversación.
 *  3b. PR 2 — Notas: «Nueva nota» en el panel del chat (con la línea de
 *     quién la ve), la nota aparece en «Notas de trabajo», se abre en Trabajo
 *     → Notas y «Abrir chat» vuelve al chat. En Notas: una nota privada, con
 *     color y fijada arriba.
 *  4. Permisos: la Coordinadora ve las tareas de todas; la Asesora no ve las
 *     de otros ni puede tocarlas (404).
 *  5. Interno: nada de esto generó un mensaje.
 *  6. Módulos: sin `trabajo`, Tareas no existe (404 en API y página) y
 *     «Trabajo» solo trae Citas; sin `agenda` tampoco, el menú no muestra
 *     «Trabajo» y /trabajo es 404.
 *
 * Uso: app viva con WA_MOCK_ENABLED=true, los mocks y PLATFORM_ORG_ID = la
 * organización de e2e@vocero.test (corre antes pnpm test:e2e).
 *   node --env-file=.env scripts/e2e-trabajo.mjs
 * Con SHOTS_DIR=<carpeta> guarda capturas. Re-ejecutable (cada corrida crea
 * su propia organización). Sale con 1 si algo falla.
 */
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR ?? null;
const RUN = Date.now().toString().slice(-7);
const ADMIN = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
const OWNER = { email: `duena.trabajo.${RUN}@trabajo.test`, name: `Dueña Trabajo ${RUN}` };
const COORD = { email: `coord.trabajo.${RUN}@trabajo.test`, name: `Coordinadora Trabajo ${RUN}` };
const ASESOR = { email: `asesora.trabajo.${RUN}@trabajo.test`, name: `Asesora Trabajo ${RUN}` };
const PASS = "contraseña-de-trabajo-1";
const PN = `PN-E2E-TRABAJO-${RUN}`;
const CLIENTE = `52155${RUN.padStart(8, "0").slice(-8)}`;
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
    if (await cond().catch(() => false)) return true;
    if (Date.now() > fin) return false;
    await sleep(300);
  }
}

const sql = postgres(process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL, { max: 2, onnotice: () => {} });
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
);

let ips = 0;
/** Una persona: su propio navegador (cookies) y su propia IP (límite de login). */
async function persona(viewport = { width: 1440, height: 900 }) {
  ips++;
  const ctx = await browser.newContext({
    viewport,
    locale: "es-MX",
    extraHTTPHeaders: { "x-forwarded-for": `10.93.${Number(RUN.slice(-3)) % 256}.${ips}`, origin: BASE },
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

const shot = async (p, name) => {
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` });
};

/**
 * La lista de Tareas ya cargó (y React ya hidrató): antes de eso, escribir o
 * tocar se pierde. En CI `next dev` compila la página al pedirla y tarda.
 */
async function listaLista(p) {
  await p.locator('section[aria-label="Tareas"][aria-busy="false"]').waitFor({ state: "attached", timeout: 90000 });
}

/** Los renglones del menú lateral (sin Ajustes ni Plataforma). */
async function menu(p) {
  const nav = p.locator("aside nav").first();
  await nav.waitFor({ state: "attached", timeout: 60000 });
  return (await nav.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("title") ?? a.textContent?.trim() ?? ""))).filter(Boolean);
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
  execFileSync("node", ["scripts/platform-admin.mjs", "add", "--email", ADMIN.email, "--apply"], { env: process.env, encoding: "utf8" });
  await sql`update platform_admin set failed_reauth = 0, locked_until = null where user_id = (select id from "user" where email = ${ADMIN.email})`;

  const alta = await A.call("POST", "/api/platform/organizations", {
    name: `Negocio Trabajo ${RUN}`,
    ownerName: OWNER.name,
    ownerEmail: OWNER.email,
    profile: "completo",
  });
  const orgId = alta.json?.organizationId;
  const token = String(alta.json?.activationUrl ?? "").split("/").pop();
  ok("alta con perfil Completo", alta.status === 201, JSON.stringify(alta.json));
  ok("activación de la Propietaria", (await A.call("POST", `/api/account-link/${token}`, { password: PASS })).status === 200);
  const [mod] = await sql`select agenda, trabajo from organization_module where organization_id = ${orgId}`;
  ok("Completo enciende Citas (agenda) y Tareas y notas (trabajo)", mod?.agenda === true && mod?.trabajo === true, JSON.stringify(mod));

  const O = await persona();
  ok("la Propietaria entra", (await O.entrar(OWNER.email, PASS)).status < 400);
  for (const [p, role] of [[COORD, "coordinador"], [ASESOR, "asesor"]]) {
    const r = await O.call("POST", "/api/settings/team", { name: p.name, email: p.email, password: PASS, role });
    ok(`alta de ${role}`, r.status === 201, JSON.stringify(r.json));
  }
  const C = await persona();
  const S = await persona();
  ok("la Coordinadora entra", (await C.entrar(COORD.email, PASS)).status < 400);
  ok("la Asesora entra", (await S.entrar(ASESOR.email, PASS)).status < 400);

  // Un cliente escribe por WhatsApp (mock) y su chat se le asigna a la Asesora.
  ok("el negocio conecta su WhatsApp", (await O.call("PUT", "/api/settings/whatsapp", { wabaId: `WABA-TRABAJO-${RUN}`, phoneNumberId: PN, token: "tok-trabajo" })).status === 200);
  const entra = await A.call("POST", "/api/dev/wa-mock/inbound", {
    phoneNumberId: PN,
    from: CLIENTE,
    name: `Clienta Trabajo ${RUN}`,
    text: "Hola, ¿me mandan la cotización?",
    waMessageId: `wamid.trabajo.${RUN}`,
  });
  ok("llega un mensaje de la clienta", entra.status < 300, JSON.stringify(entra.json));
  const [chat] = await hasta(async () => (await sql`select ct.id as contact, cv.id as conv from contact ct join conversation cv on cv.contact_id = ct.id where ct.organization_id = ${orgId}`).length > 0, 20000)
    ? await sql`select ct.id as contact, cv.id as conv from contact ct join conversation cv on cv.contact_id = ct.id where ct.organization_id = ${orgId}`
    : [];
  ok("su contacto y su chat existen", !!chat?.contact);
  const [asesora] = await sql`select id from "user" where email = ${ASESOR.email}`;
  const asigna = await O.call("POST", "/api/assignments", { contactIds: [chat?.contact], userId: asesora?.id });
  ok("el chat se asigna a la Asesora", asigna.status === 200, JSON.stringify(asigna.json));
  const [{ n: mensajesAntes }] = await sql`select count(*)::int as n from message where organization_id = ${orgId}`;

  console.log("\n== 1 · Un solo ítem «Trabajo»; Citas abre en la Lista ==");
  const inicio = await O.pagina("/inbox");
  const items = await menu(inicio.p);
  ok("el menú muestra «Trabajo» y ya no «Citas»", items.includes("Trabajo") && !items.includes("Citas"), items.join(", "));
  await inicio.p.locator("aside nav").first().getByRole("link", { name: "Trabajo" }).click();
  ok("«Trabajo» abre Citas en la vista Lista", await hasta(async () => /\/bookings\?vista=lista/.test(inicio.p.url()), 60000), inicio.p.url());
  const tabs = inicio.p.getByRole("navigation", { name: "Secciones de Trabajo" });
  ok(
    "con las pestañas Citas, Tareas y Notas",
    (await tabs.getByRole("link", { name: "Citas" }).count()) === 1 &&
      (await tabs.getByRole("link", { name: "Tareas" }).count()) === 1 &&
      (await tabs.getByRole("link", { name: "Notas" }).count()) === 1
  );
  ok("«Trabajo» se ve activo en el menú estando en Citas", (await inicio.p.locator('aside nav a[href="/trabajo"]').first().getAttribute("class"))?.includes("bg-brand-tint"));
  await hasta(async () => (await inicio.p.getByText("Cargando…").count()) === 0, 20000);
  await shot(inicio.p, "trabajo-1-citas-lista");
  await inicio.p.close();

  console.log("\n== 2 · Alta rápida y marcar hecha de un toque ==");
  const tareas = await S.pagina("/trabajo/tareas");
  ok("la Asesora abre Tareas (200)", tareas.status === 200, String(tareas.status));
  const titulo = `Llamar al proveedor ${RUN}`;
  await listaLista(tareas.p);
  const rapido = tareas.p.getByRole("textbox", { name: "Agregar tarea" });
  await rapido.fill(titulo);
  await rapido.press("Enter");
  const renglon = tareas.p.getByRole("button", { name: titulo, exact: false }).first();
  ok("la tarea aparece en «Mis tareas»", await hasta(async () => (await renglon.count()) > 0, 20000));
  await shot(tareas.p, "trabajo-2-tareas-lista");
  await tareas.p.getByRole("button", { name: `Marcar «${titulo}» como hecha` }).click();
  ok(
    "un toque la marca hecha y sale de pendientes",
    await hasta(async () => (await tareas.p.getByRole("button", { name: `Marcar «${titulo}» como hecha` }).count()) === 0 && (await renglon.count()) === 0, 15000)
  );
  await tareas.p.getByRole("button", { name: "Hechas", exact: true }).click();
  ok("aparece en «Hechas», tachada", await hasta(async () => (await tareas.p.getByRole("button", { name: `Marcar «${titulo}» como pendiente` }).count()) === 1, 15000));
  const [fila] = await sql`select done_at, done_by from work_task where organization_id = ${orgId} and title = ${titulo}`;
  ok("…y en la base: hecha por la Asesora", !!fila?.done_at && fila?.done_by === asesora?.id, JSON.stringify(fila));
  await tareas.p.close();

  console.log("\n== 3 · Nueva tarea desde un chat de la Bandeja ==");
  const bandeja = await S.pagina(`/inbox?contact=${chat?.contact}`);
  const enlace = bandeja.p.getByRole("link", { name: "Nueva tarea para este chat" });
  ok("el panel del chat ofrece «Nueva tarea para este chat»", await hasta(async () => (await enlace.count()) > 0, 60000));
  await shot(bandeja.p, "trabajo-3-chat");
  await enlace.click();
  ok("abre el formulario de Tareas", await hasta(async () => bandeja.p.url().includes("/trabajo/tareas?nueva=1"), 60000), bandeja.p.url());
  const delChat = `Mandar cotización ${RUN}`;
  await listaLista(bandeja.p);
  await bandeja.p.getByRole("textbox", { name: "Título" }).fill(delChat);
  ok("ya viene ligada a la clienta", await hasta(async () => (await bandeja.p.getByText(`Clienta Trabajo ${RUN}`).count()) > 0));
  await bandeja.p.getByRole("button", { name: "Guardar" }).click();
  ok("se guarda", await hasta(async () => (await bandeja.p.getByRole("status").filter({ hasText: "Guardado" }).count()) > 0, 15000));
  const [ligada] = await sql`select contact_id, conversation_id, assignee_user_id from work_task where organization_id = ${orgId} and title = ${delChat}`;
  ok("en la base: ligada al contacto y al chat, a cargo de la Asesora", ligada?.contact_id === chat?.contact && ligada?.conversation_id === chat?.conv && ligada?.assignee_user_id === asesora?.id, JSON.stringify(ligada));
  await shot(bandeja.p, "trabajo-4-detalle");
  await bandeja.p.getByRole("link", { name: "Abrir chat" }).click();
  ok("«Abrir chat» vuelve a esa conversación", await hasta(async () => bandeja.p.url().includes(`/inbox?contact=${chat?.contact}`), 60000), bandeja.p.url());
  await bandeja.p.close();

  console.log("\n== 3b · Nota desde el chat y abrir el chat desde la nota ==");
  const HINT = "Las notas ligadas a un chat las ve todo el equipo que puede ver ese contacto. Una nota sin ligar es solo para quien la escribe.";
  const chatN = await S.pagina(`/inbox?contact=${chat?.contact}`);
  const seccion = chatN.p.getByRole("region", { name: "Notas de trabajo" });
  ok("el panel del chat tiene «Notas de trabajo» con «Nueva nota»", await hasta(async () => (await seccion.getByRole("button", { name: "Nueva nota" }).count()) > 0, 60000));
  ok("…y la línea de quién ve las notas", (await seccion.getByText(HINT).count()) === 1);
  await seccion.getByRole("button", { name: "Nueva nota" }).click();
  const textoNota = `Prefiere llamada por la tarde ${RUN}`;
  await seccion.getByRole("textbox", { name: "Nueva nota de trabajo" }).fill(textoNota);
  await seccion.getByRole("button", { name: "Guardar nota" }).click();
  const tarjeta = seccion.getByRole("link", { name: new RegExp(`Abrir nota: ${textoNota.slice(0, 20)}`) });
  ok("la nota aparece en el chat", await hasta(async () => (await tarjeta.count()) === 1, 15000));
  const [nota] = await sql`select id, contact_id, conversation_id, author_user_id from work_note where organization_id = ${orgId} and body = ${textoNota}`;
  ok("en la base: ligada al contacto y al chat, escrita por la Asesora", nota?.contact_id === chat?.contact && nota?.conversation_id === chat?.conv && nota?.author_user_id === asesora?.id, JSON.stringify(nota));
  await shot(chatN.p, "trabajo-7-chat-notas");
  await tarjeta.click();
  ok("tocar la nota la abre en Trabajo → Notas", await hasta(async () => chatN.p.url().includes(`/trabajo/notas?nota=${nota?.id}`), 60000), chatN.p.url());
  const detalle = chatN.p.getByRole("region", { name: "Detalle de la nota" });
  ok("el editor muestra la línea de quién la ve", await hasta(async () => (await detalle.getByText(HINT).count()) === 1, 30000));
  await shot(chatN.p, "trabajo-8-nota-del-chat");
  await detalle.getByRole("link", { name: "Abrir chat" }).click();
  ok("«Abrir chat» desde la nota vuelve a esa conversación", await hasta(async () => chatN.p.url().includes(`/inbox?contact=${chat?.contact}`), 60000), chatN.p.url());
  await chatN.p.close();

  const notas = await S.pagina("/trabajo/notas");
  await notas.p.locator('section[aria-label="Notas"][aria-busy="false"]').waitFor({ state: "attached", timeout: 90000 });
  await notas.p.getByRole("button", { name: "Nueva nota" }).click();
  const nueva = notas.p.getByRole("region", { name: "Detalle de la nota" });
  ok("una nota sin ligar dice que solo la ve quien la escribe", (await nueva.getByText(/^Solo tú ves esta nota/).count()) === 1);
  const privada = `Ideas para la promo ${RUN}`;
  await nueva.getByRole("textbox", { name: "Título" }).fill("Promo");
  await nueva.getByRole("textbox", { name: "Nota" }).fill(privada);
  await nueva.getByRole("radio", { name: "Amarillo" }).click();
  await nueva.getByRole("button", { name: "Guardar" }).click();
  ok("se guarda", await hasta(async () => (await nueva.getByRole("status").count()) > 0, 15000));
  await nueva.getByRole("button", { name: "Fijar arriba" }).click();
  ok("fijada arriba, en «Fijadas»", await hasta(async () => (await notas.p.getByText("Fijadas", { exact: true }).count()) === 1, 15000));
  const [notaPrivada] = await sql`select id, color, pinned_at, contact_id from work_note where organization_id = ${orgId} and body = ${privada}`;
  ok("en la base: amarilla, fijada y sin ligar", notaPrivada?.color === "amarillo" && !!notaPrivada?.pinned_at && notaPrivada?.contact_id === null, JSON.stringify(notaPrivada));
  await shot(notas.p, "trabajo-9-notas");
  await notas.p.close();
  ok("la Propietaria NO ve la nota privada de la Asesora (404)", (await O.call("GET", `/api/work/notes/${notaPrivada?.id}`)).status === 404);
  const enChatCoord = (await C.call("GET", `/api/work/notes?contactId=${chat?.contact}`)).json?.notes ?? [];
  ok("la Coordinadora sí ve la nota del chat", enChatCoord.some((n) => n.id === nota?.id));

  console.log("\n== 4 · Permisos ==");
  const deLaDuena = await O.call("POST", "/api/work/tasks", { title: `Pagar renta ${RUN}` });
  ok("la Propietaria crea la suya", deLaDuena.status === 201);
  const vistaAsesora = (await S.call("GET", "/api/work/tasks?filter=all")).json?.tasks ?? [];
  ok("la Asesora no ve la tarea de la Propietaria", !vistaAsesora.some((t) => t.title === `Pagar renta ${RUN}`));
  ok("…ni la puede tocar (404)", (await S.call("PATCH", `/api/work/tasks/${deLaDuena.json?.task?.id}`, { done: true })).status === 404);
  const vistaCoord = (await C.call("GET", "/api/work/tasks?filter=all")).json?.tasks ?? [];
  ok("la Coordinadora ve las de todas (work.manage)", vistaCoord.some((t) => t.title === `Pagar renta ${RUN}`) && vistaCoord.some((t) => t.title === delChat));

  console.log("\n== 5 · Interno: ningún envío ==");
  const [{ n: mensajesDespues }] = await sql`select count(*)::int as n from message where organization_id = ${orgId}`;
  ok("las tareas y las notas no generaron mensajes", mensajesDespues === mensajesAntes, `${mensajesAntes} → ${mensajesDespues}`);

  console.log("\n== 6 · Cada pestaña con su módulo ==");
  await A.call("POST", `/api/platform/organizations/${orgId}/modules`, { trabajo: false });
  await sleep(CACHE_MS);
  ok("sin `trabajo`: API de Tareas 404", (await S.call("GET", "/api/work/tasks")).status === 404);
  ok("sin `trabajo`: API de Notas 404", (await S.call("GET", "/api/work/notes")).status === 404);
  const sinNotas = await S.pagina("/trabajo/notas");
  ok("sin `trabajo`: la página de Notas es 404", sinNotas.status === 404, String(sinNotas.status));
  await sinNotas.p.close();
  const sinTareas = await S.pagina("/trabajo/tareas");
  ok("sin `trabajo`: la página de Tareas es 404", sinTareas.status === 404, String(sinTareas.status));
  await sinTareas.p.close();
  const soloCitas = await S.pagina("/trabajo");
  ok("«Trabajo» lleva a Citas", await hasta(async () => soloCitas.p.url().includes("/bookings"), 60000), soloCitas.p.url());
  ok("…sin pestañas (solo hay una)", (await soloCitas.p.getByRole("navigation", { name: "Secciones de Trabajo" }).count()) === 0);
  ok("…y el menú sigue mostrando «Trabajo»", (await menu(soloCitas.p)).includes("Trabajo"));
  await soloCitas.p.close();
  await A.call("POST", `/api/platform/organizations/${orgId}/modules`, { agenda: false, trabajo: true });
  await sleep(CACHE_MS);
  const soloTareas = await S.pagina("/trabajo");
  ok("solo `trabajo`: «Trabajo» lleva a Tareas", await hasta(async () => soloTareas.p.url().includes("/trabajo/tareas"), 60000), soloTareas.p.url());
  await soloTareas.p.close();
  ok("…y Citas no existe (404)", (await S.call("GET", "/api/bookings")).status === 404);
  await A.call("POST", `/api/platform/organizations/${orgId}/modules`, { agenda: false, trabajo: false });
  await sleep(CACHE_MS);
  const nada = await S.pagina("/inbox");
  ok("sin ninguno de los dos: el menú no muestra «Trabajo»", !(await menu(nada.p)).includes("Trabajo"));
  await nada.p.close();
  const trabajo404 = await S.pagina("/trabajo");
  ok("…y /trabajo es 404", trabajo404.status === 404, String(trabajo404.status));
  await trabajo404.p.close();
  await A.call("POST", `/api/platform/organizations/${orgId}/modules`, { agenda: true, trabajo: true });

  // Capturas extra en celular (si se piden).
  if (SHOTS) {
    await sleep(CACHE_MS);
    const tel = await persona({ width: 390, height: 844 });
    await tel.entrar(ASESOR.email, PASS);
    const t = await tel.pagina("/trabajo/tareas?filter=mine");
    await hasta(async () => (await t.p.getByRole("button", { name: "Hechas", exact: true }).count()) > 0, 30000);
    await t.p.getByRole("button", { name: "Todas", exact: true }).click();
    // El renglón (no el círculo, cuyo nombre empieza con «Marcar…»).
    const fila = t.p.getByRole("button", { name: new RegExp(`^${delChat}`) }).first();
    await hasta(async () => (await fila.count()) > 0, 30000);
    await shot(t.p, "trabajo-5-tareas-celular");
    await fila.click();
    await sleep(800);
    await shot(t.p, "trabajo-6-detalle-celular");
    const n = await tel.pagina("/trabajo/notas");
    await n.p.locator('section[aria-label="Notas"][aria-busy="false"]').waitFor({ state: "attached", timeout: 90000 });
    await shot(n.p, "trabajo-10-notas-celular");
  }
}

try {
  await main();
} catch (err) {
  failures++;
  console.error("  FAIL excepción:", err);
} finally {
  await browser.close();
  await sql.end();
}
console.log(`\n${checks - failures}/${checks} comprobaciones en verde`);
if (failures > 0) {
  console.log("Fallaron:\n" + fallas.map((f) => `  · ${f}`).join("\n"));
  process.exit(1);
}
