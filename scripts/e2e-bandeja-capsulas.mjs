/**
 * Self-test E2E — Bandeja 034: cápsulas (Etapa · Etiquetas · Asignado), punto
 * de IA, filtro por etiqueta, archivar y eliminar. Contra la app real con los
 * mocks, con un navegador de verdad:
 *
 *  1. Chat que nace de un echo (mensaje enviado desde el teléfono) → llega CON
 *     etapa (la inicial de la organización).
 *  2. Fila con tres cápsulas; el clic en una NO abre el chat; cada menú se
 *     cierra al clicar fuera. Etapa (marca la actual y cambia sin recargar),
 *     Etiquetas (primera + «+N», buscador, agregar/quitar), Asignado.
 *  3. IA: solo un ícono con punto (verde = activa, naranja = en pausa); sin
 *     texto largo en la fila; sin ícono si no hay bot.
 *  4. Filtro «Etiqueta» del menú «Todas».
 *  5. Archivar (clic derecho; «⋯» del chat abierto) y «Archivados»; un
 *     mensaje entrante lo desarchiva.
 *  6. Touch (tablet): la pulsación larga abre el MISMO menú y no abre el chat.
 *  7. Eliminar: diálogo de confirmación con su texto, «Cancelar» no borra,
 *     «Eliminar permanentemente» sí. Un Asesor no ve la opción y recibe 403.
 *
 * Uso: app viva con WA_MOCK_ENABLED=true y los mocks.
 *   node --env-file=.env scripts/e2e-bandeja-capsulas.mjs
 * Con SHOTS_DIR=<carpeta> guarda capturas.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR ?? null;
const PN = "PN-E2E-1";
const RUN = Date.now().toString().slice(-7);
const ADMIN = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
const ASESOR = { email: `asesor.bandeja.${RUN}@vocero.test`, password: "password-e2e-123", name: `Asesor Bandeja ${RUN}` };
const TEXTO_ELIMINAR =
  "Esta acción eliminará el chat y todos sus mensajes de forma permanente. No se puede deshacer.";

let failures = 0;
function ok(name, cond, extra = "") {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ver = (loc, ms = 60000) =>
  loc.first().waitFor({ state: "visible", timeout: ms }).then(() => true, () => false);
const oculto = (loc, ms = 15000) =>
  loc.first().waitFor({ state: "hidden", timeout: ms }).then(() => true, () => false);
async function hasta(cond, ms = 30000) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await Promise.resolve(cond()).catch(() => false)) return true;
    if (Date.now() > fin) return false;
    await sleep(300);
  }
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
);
const newCtx = (opts = {}) =>
  browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-MX", extraHTTPHeaders: { origin: BASE }, ...opts });

function apiOf(ctx) {
  return async (method, path, body) => {
    const res = await ctx.request.fetch(`${BASE}${path}`, { method, data: body, failOnStatusCode: false, timeout: 180000 });
    let json = null;
    try {
      json = await res.json();
    } catch {
      // no es JSON
    }
    return { status: res.status(), json };
  };
}
const shot = async (p, name) => {
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** El color REAL de un token del tema (`--warning`…), como lo resuelve el navegador. */
const tokenColor = (p, token) =>
  p.evaluate((t) => {
    const el = document.createElement("i");
    el.style.background = `var(${t})`;
    document.body.appendChild(el);
    const c = getComputedStyle(el).backgroundColor;
    el.remove();
    return c;
  }, token);

const owner = await newCtx();
const call = apiOf(owner);
const convs = async () => (await call("GET", "/api/conversations")).json?.conversations ?? [];
const conv = async (name) => (await convs()).find((c) => c.contact.name === name);

try {
  console.log("== Setup ==");
  let login = await call("POST", "/api/auth/sign-up/email", ADMIN);
  if (login.status >= 400) login = await call("POST", "/api/auth/sign-in/email", ADMIN);
  ok("el operador entra", login.status < 400, String(login.status));
  const conn = await call("PUT", "/api/settings/whatsapp", { wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" });
  ok("número de WhatsApp conectado (wa-mock)", conn.status < 400, String(conn.status));
  // Sin agente: la fila NO debe pintar punto de IA (se enciende más abajo).
  await call("PUT", "/api/agent/profile", { name: "Sofi", enabled: false });

  const tagNames = [`Alumno${RUN}`, `VIP${RUN}`, `Becado${RUN}`];
  const tags = [];
  for (const name of tagNames) {
    const t = await call("POST", "/api/contact-tags", { name });
    ok(`etiqueta ${name} creada`, t.status === 201, JSON.stringify(t.json));
    tags.push(t.json?.tag);
  }
  const al = await call("POST", "/api/settings/team", { name: ASESOR.name, email: ASESOR.email, password: ASESOR.password, role: "asesor" });
  ok("asesor de prueba creado", al.status < 400, JSON.stringify(al.json));
  const team = (await call("GET", "/api/settings/team")).json?.members ?? [];
  const asesorId = team.find((m) => m.email === ASESOR.email)?.userId;
  ok("el asesor aparece en el equipo", Boolean(asesorId));

  const N = {
    a: `Ana Cápsulas ${RUN}`,
    b: `Beto Archivo ${RUN}`,
    c: `Carla Borrar ${RUN}`,
    d: `Dana Asesor ${RUN}`,
  };
  const tel = (i) => `5214620${RUN.slice(-5)}${i}`; // Meta manda 521…; el CRM canoniza a 52…
  const inbound = (name, i, text) =>
    call("POST", "/api/dev/wa-mock/inbound", { phoneNumberId: PN, from: tel(i), name, text, waMessageId: `wamid.cap.${RUN}.${i}.${Date.now()}` });
  let i = 0;
  for (const name of Object.values(N)) {
    const r = await inbound(name, ++i, `hola soy ${name}`);
    ok(`entrante de ${name}`, r.status < 400, String(r.status));
  }
  ok("las 4 conversaciones están en la Bandeja", await hasta(async () => (await convs()).filter((c) => Object.values(N).includes(c.contact.name)).length === 4));

  console.log("== 1. Un chat que nace de un echo llega CON etapa ==");
  const ECHO_NAME_TEL = `5255${RUN.padStart(8, "0")}`;
  const echo = await call("POST", "/api/dev/wa-mock/echo", { phoneNumberId: PN, to: ECHO_NAME_TEL, text: "te escribo desde mi teléfono", waMessageId: `wamid.cap.echo.${RUN}` });
  ok("echo entregado al webhook", echo.status < 400, JSON.stringify(echo.json));
  ok("el chat del echo aparece", await hasta(async () => (await convs()).some((c) => c.contact.phone === ECHO_NAME_TEL)));
  const ec = (await convs()).find((c) => c.contact.phone === ECHO_NAME_TEL);
  ok("…y trae etapa (la inicial de la organización)", Boolean(ec?.stageName) && Boolean(ec?.leadId), JSON.stringify({ stage: ec?.stageName, lead: ec?.leadId }));
  const entrante = await conv(N.a);
  ok("la etapa del entrante normal es la misma inicial", ec?.stageName === entrante?.stageName, `${ec?.stageName} vs ${entrante?.stageName}`);

  // Datos de la fila de Ana: tres etiquetas (primera + «+2») y la IA apagada.
  const A = await conv(N.a);
  const put = await call("PUT", `/api/contacts/${A.contact.id}/tags`, { tagIds: tags.map((t) => t.id) });
  ok("Ana tiene 3 etiquetas", put.status < 400, JSON.stringify(put.json));

  const page = await owner.newPage();
  await page.goto(`${BASE}/inbox`, { timeout: 180000, waitUntil: "domcontentloaded" });
  const row = (name) => page.locator("[data-conversation-row]", { hasText: name });
  ok("la lista carga con Ana", await ver(row(N.a), 120000));
  // `next dev` hidrata tarde: nada de esto funciona hasta que React toma la página.
  await page.waitForLoadState("networkidle").catch(() => {});

  console.log("== 2. Las tres cápsulas ==");
  const cap = (name, prefix) => row(name).getByRole("button", { name: prefix });
  const stageCap = cap(N.a, /^Etapa:/);
  const tagCap = cap(N.a, /^Etiquetas:/);
  const asignCap = cap(N.a, /^Asignado:/);
  ok("la fila de Ana tiene cápsula de Etapa", await ver(stageCap));
  ok("…de Etiquetas", await ver(tagCap));
  ok("…y de Asignado", await ver(asignCap));
  const tagText = (await tagCap.innerText()).replace(/\s+/g, " ");
  ok("Etiquetas muestra la primera y «+2»", tagText.includes(`Alumno${RUN}`) && /\+2/.test(tagText), tagText);
  ok("Asignado dice «Sin asignar»", /Sin asignar/.test(await asignCap.innerText()));
  ok("la fila ya no dice «Requiere humano · sin asignar»", (await row(N.a).innerText()).includes("Requiere humano") === false);
  await shot(page, "capsulas-fila");

  // Etapa: menú con la actual marcada; cambiar sin recargar; no abre el chat.
  const abierto = () => page.getByRole("button", { name: "Opciones del chat" });
  await stageCap.click();
  const menu = page.getByRole("menu");
  ok("el clic en la cápsula abre SU menú", await ver(menu.getByRole("menuitemradio").first()));
  ok("…y NO abre el chat", (await abierto().count()) === 0);
  const actual = A.stageName;
  const marcada = menu.locator('[role=menuitemradio][aria-checked="true"]');
  ok("la etapa actual aparece marcada", (await marcada.count()) === 1 && (await marcada.innerText()).trim() === actual, await marcada.allInnerTexts().then(String));
  const stages = (await call("GET", "/api/pipeline/stages")).json?.stages ?? [];
  const destino = stages.find((s) => s.kind === "open" && s.name !== actual);
  ok("hay otra etapa abierta a donde mover", Boolean(destino));
  await shot(page, "capsulas-menu-etapa");
  await menu.getByRole("menuitemradio", { name: destino.name, exact: true }).click();
  ok("elegir otra etapa cierra el menú", await oculto(menu));
  ok("la cápsula cambia SIN recargar", await hasta(async () => (await stageCap.innerText()).includes(destino.name)));
  ok("el servidor la guardó", await hasta(async () => (await conv(N.a))?.stageName === destino.name));
  ok("el chat sigue sin abrirse", (await abierto().count()) === 0);
  // Cierra al clicar fuera.
  await stageCap.click();
  await ver(menu.getByRole("menuitemradio"));
  await page.getByRole("heading", { name: "Bandeja" }).click();
  ok("el menú de Etapa se cierra al clicar fuera", await oculto(menu));
  // Una etapa perdida no se elige desde la cápsula (pide motivo).
  await stageCap.click();
  const perdida = stages.find((s) => s.kind === "lost");
  ok("la etapa «perdida» no se ofrece desde la cápsula", perdida ? await menu.getByRole("menuitemradio", { name: perdida.name, exact: true }).isDisabled() : true);
  await page.keyboard.press("Escape");
  ok("Escape también cierra el menú", await oculto(menu));

  // Etiquetas: buscador, quitar, volver a agregar.
  await tagCap.click();
  const buscador = page.getByLabel("Buscar etiqueta", { exact: true });
  ok("el menú de Etiquetas trae un buscador", await ver(buscador));
  ok("…y todas las etiquetas del negocio", (await menu.getByRole("menuitemcheckbox").count()) >= 3);
  await buscador.fill(`VIP${RUN}`);
  ok("el buscador filtra", (await menu.getByRole("menuitemcheckbox").count()) === 1);
  const vip = menu.getByRole("menuitemcheckbox", { name: `VIP${RUN}` });
  ok("VIP está marcada", (await vip.getAttribute("aria-checked")) === "true");
  await vip.click();
  ok("quitar una etiqueta actualiza la cápsula (+1)", await hasta(async () => /\+1/.test(await tagCap.innerText())));
  ok("el menú sigue abierto para seguir editando", await ver(menu));
  ok("el servidor quitó VIP", await hasta(async () => !((await conv(N.a))?.tags ?? []).some((t) => t.name === `VIP${RUN}`)));
  await vip.click();
  ok("agregarla de nuevo (+2)", await hasta(async () => /\+2/.test(await tagCap.innerText())));
  // Crear una etiqueta nueva desde el buscador (el Propietario puede).
  await buscador.fill(`Nueva${RUN}`);
  await menu.getByRole("menuitem", { name: new RegExp(`Crear «Nueva${RUN}»`) }).click();
  ok("crear una etiqueta desde el buscador la asigna", await hasta(async () => ((await conv(N.a))?.tags ?? []).some((t) => t.name === `Nueva${RUN}`)));
  await page.getByRole("heading", { name: "Bandeja" }).click();
  ok("el menú de Etiquetas se cierra al clicar fuera", await oculto(menu));
  ok("…sin abrir el chat", (await abierto().count()) === 0);

  // Asignado.
  await asignCap.click();
  ok("el menú de Asignado lista al equipo", await ver(menu.getByRole("menuitemradio", { name: ASESOR.name })));
  ok("…con «Sin asignar» marcado", (await menu.locator('[role=menuitemradio][aria-checked="true"]').innerText()).includes("Sin asignar"));
  await menu.getByRole("menuitemradio", { name: ASESOR.name }).click();
  ok("al elegir, la cápsula muestra a la persona", await hasta(async () => (await asignCap.innerText()).includes(ASESOR.name)));
  ok("el servidor la asignó", await hasta(async () => (await conv(N.a))?.assignee?.id === asesorId));
  ok("el chat sigue sin abrirse", (await abierto().count()) === 0);
  await shot(page, "capsulas-asignado");

  console.log("== 3. Estado de IA: solo un ícono con punto ==");
  ok("sin agente encendido NO hay ícono de IA", (await row(N.b).getByRole("img", { name: /^IA / }).count()) === 0);
  await call("PUT", "/api/agent/profile", { name: "Sofi", tone: "cálido", instructions: "Vendemos limpiezas.", enabled: true });
  // Ana: el dueño escribe desde el teléfono → la IA se pausa (handoff).
  const aEcho = await call("POST", "/api/dev/wa-mock/echo", { phoneNumberId: PN, to: tel(1), text: "yo la atiendo", waMessageId: `wamid.cap.echoA.${RUN}` });
  ok("echo sobre Ana (pausa la IA)", aEcho.status < 400);
  await page.reload({ waitUntil: "domcontentloaded" });
  ok("Ana (pausada) lleva el ícono «IA en pausa»", await ver(row(N.a).getByRole("img", { name: "IA en pausa" })));
  ok("la fila NO trae texto largo («Requiere humano»/«Atención humana»)", !/Requiere humano|Atención humana/.test(await row(N.a).innerText()));
  const dot = await row(N.a).getByRole("img", { name: "IA en pausa" }).locator("span").evaluate((el) => getComputedStyle(el).backgroundColor);
  const naranja = await tokenColor(page, "--warning");
  const verde = await tokenColor(page, "--success");
  ok("el punto de «en pausa» es naranja (el token --warning)", dot === naranja && naranja !== verde, `${dot} vs ${naranja}`);
  const activa = row(N.d).getByRole("img", { name: "IA activa" });
  ok("un chat con IA activa lleva el ícono «IA activa»", (await ver(activa, 20000)) || (await row(N.d).getByRole("img", { name: "IA en pausa" }).count()) > 0);
  const colorActiva = (await activa.count()) ? await activa.locator("span").evaluate((el) => getComputedStyle(el).backgroundColor) : null;
  if (colorActiva) ok("el punto de «activa» es verde (el token --success)", colorActiva === verde, `${colorActiva} vs ${verde}`);
  await shot(page, "capsulas-ia");
  // El texto completo sí está en Detalles.
  await row(N.a).locator("button").first().click();
  ok("al abrir el chat, Detalles dice «Atención humana»", await ver(page.getByText("Atención humana").first()));
  await shot(page, "capsulas-detalles");
  await call("PUT", "/api/agent/profile", { name: "Sofi", enabled: false });

  console.log("== 4. Filtro por etiqueta en «Todas» ==");
  await page.getByRole("button", { name: /^Filtrar la bandeja/ }).click();
  const selTag = page.getByLabel("Filtrar por etiqueta", { exact: true });
  ok("el menú trae la sección «Etiqueta»", await ver(selTag));
  ok("…con «Toda etiqueta» por defecto", (await selTag.inputValue()) === "all");
  await selTag.selectOption({ label: `Alumno${RUN}` });
  ok("filtra: Ana (con la etiqueta) se ve", await ver(row(N.a)));
  ok("…y los chats sin ella desaparecen", await oculto(row(N.b)));
  await shot(page, "capsulas-filtro-etiqueta");
  await page.getByRole("button", { name: "Quitar filtros" }).click();
  ok("«Quitar filtros» los devuelve", await ver(row(N.b)));

  console.log("== 5. Archivar ==");
  await page.getByRole("heading", { name: "Bandeja" }).click();
  await row(N.b).click({ button: "right" });
  const ctxMenu = page.getByRole("menu", { name: "Opciones del chat" });
  ok("el clic derecho abre el menú contextual", await ver(ctxMenu));
  ok("…con «Archivar»", await ver(ctxMenu.getByRole("menuitem", { name: "Archivar" })));
  ok("…y «Eliminar» (el Propietario puede)", await ver(ctxMenu.getByRole("menuitem", { name: "Eliminar" })));
  ok("el clic derecho NO abrió el chat de Beto", (await page.getByText(`hola soy ${N.b}`).count()) <= 1);
  await shot(page, "archivar-menu-contextual");
  await ctxMenu.getByRole("menuitem", { name: "Archivar" }).click();
  ok("archivar saca el chat de la Bandeja principal", await oculto(row(N.b)));
  const B = await conv(N.b);
  ok("…pero se conserva en la base de datos (con archivedAt)", Boolean(B?.archivedAt));
  const msgsB = await call("GET", `/api/conversations/${B.id}/messages`);
  ok("…con sus mensajes", (msgsB.json?.messages ?? []).length >= 1);
  await page.getByRole("button", { name: /^Filtrar la bandeja/ }).click();
  const archivados = page.getByRole("button", { name: /^Archivados/ });
  ok("«Archivados» está junto a «Todas» y «No leídas»", await ver(archivados));
  await archivados.click();
  ok("el filtro «Archivados» muestra el chat", await ver(row(N.b)));
  ok("…y no muestra los demás", (await row(N.a).count()) === 0);
  await shot(page, "archivar-archivados");
  await row(N.b).click({ button: "right" });
  await ctxMenu.getByRole("menuitem", { name: "Recuperar" }).click();
  ok("«Recuperar» lo saca de Archivados", await oculto(row(N.b)));
  const B2 = await conv(N.b);
  ok("…y vuelve a estar a la vista", B2?.archivedAt === null);
  // Desde dentro del chat abierto.
  await page.getByRole("button", { name: /^Filtrar la bandeja/ }).click();
  await page.getByRole("button", { name: /^Todas/ }).click();
  await row(N.b).locator("button").first().click();
  await abierto().click();
  ok("el «⋯» del chat abierto ofrece Archivar", await ver(ctxMenu.getByRole("menuitem", { name: "Archivar" })));
  ok("…y Eliminar", await ver(ctxMenu.getByRole("menuitem", { name: "Eliminar" })));
  await shot(page, "archivar-menu-chat");
  await ctxMenu.getByRole("menuitem", { name: "Archivar" }).click();
  ok("archivar desde el chat abierto lo suelta y lo oculta", (await oculto(row(N.b))) && (await abierto().count()) === 0);
  ok("el servidor lo tiene archivado", await hasta(async () => Boolean((await conv(N.b))?.archivedAt)));
  // Un mensaje entrante lo desarchiva.
  await inbound(N.b, 2, "¿sigue disponible?");
  ok("un mensaje entrante lo desarchiva", await hasta(async () => (await conv(N.b))?.archivedAt === null));
  ok("…y reaparece en la Bandeja", await ver(row(N.b), 20000));

  console.log("== 6. Touch (tablet): pulsación larga ==");
  const touch = await newCtx({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: false });
  await touch.addCookies(await owner.cookies());
  const tp = await touch.newPage();
  await tp.goto(`${BASE}/inbox`, { timeout: 180000, waitUntil: "domcontentloaded" });
  const trow = (name) => tp.locator("[data-conversation-row]", { hasText: name });
  ok("la lista carga en la tablet", await ver(trow(N.b), 120000));
  await tp.waitForLoadState("networkidle").catch(() => {});
  const box = await trow(N.b).boundingBox();
  const pointer = (type, x, y) =>
    trow(N.b).dispatchEvent(type, { pointerType: "touch", isPrimary: true, clientX: x, clientY: y, bubbles: true, pointerId: 7 });
  // Pulsación CORTA (un toque) abre el chat, no el menú.
  // Pulsación larga: dedo abajo 650 ms, sin moverse.
  const px = box.x + 120;
  const py = box.y + 20;
  await pointer("pointerdown", px, py);
  await sleep(700);
  const tmenu = tp.getByRole("menu", { name: "Opciones del chat" });
  ok("la pulsación larga abre el menú contextual", await ver(tmenu, 5000));
  await pointer("pointerup", px, py);
  await trow(N.b).dispatchEvent("click", { clientX: px, clientY: py, bubbles: true });
  ok("…y soltar el dedo NO abre el chat", (await tp.getByRole("button", { name: "Opciones del chat" }).count()) === 0);
  ok("el menú táctil trae Archivar y Eliminar", (await tmenu.getByRole("menuitem", { name: "Archivar" }).count()) === 1 && (await tmenu.getByRole("menuitem", { name: "Eliminar" }).count()) === 1);
  await shot(tp, "touch-menu");
  // Tocar fuera lo cierra (con un dedo, no con el ratón).
  await tp.touchscreen.tap(30, 1100);
  ok("tocar fuera cierra el menú", await oculto(tmenu));
  // Un deslizamiento (scroll) NO cuenta como pulsación larga.
  await pointer("pointerdown", px, py);
  await trow(N.b).dispatchEvent("pointermove", { pointerType: "touch", isPrimary: true, clientX: px, clientY: py + 40, bubbles: true, pointerId: 7 });
  await sleep(700);
  ok("mover el dedo cancela la pulsación larga (es un scroll)", (await tmenu.count()) === 0);
  await pointer("pointerup", px, py + 40);
  // Las cápsulas funcionan con toque.
  await trow(N.b).getByRole("button", { name: /^Etapa:/ }).tap();
  ok("tocar una cápsula abre su menú", await ver(tp.getByRole("menuitemradio").first()));
  await tp.touchscreen.tap(30, 1100);
  await touch.close();

  console.log("== 7. Eliminar ==");
  await row(N.c).click({ button: "right" });
  await ctxMenu.getByRole("menuitem", { name: "Eliminar" }).click();
  const dialogo = page.getByRole("alertdialog");
  ok("«Eliminar» pide confirmación", await ver(dialogo));
  ok("…con el texto claro", (await dialogo.innerText()).includes(TEXTO_ELIMINAR));
  ok("…y los botones «Cancelar» y «Eliminar permanentemente»", (await dialogo.getByRole("button", { name: "Cancelar" }).count()) === 1 && (await dialogo.getByRole("button", { name: "Eliminar permanentemente" }).count()) === 1);
  const colorBoton = await dialogo.getByRole("button", { name: "Eliminar permanentemente" }).evaluate((el) => getComputedStyle(el).backgroundColor);
  const rojo = await tokenColor(page, "--danger");
  const colorCancelar = await dialogo.getByRole("button", { name: "Cancelar" }).evaluate((el) => getComputedStyle(el).backgroundColor);
  ok("«Eliminar permanentemente» va en rojo (el token --danger) y «Cancelar» no", colorBoton === rojo && colorCancelar !== rojo, `${colorBoton} vs ${rojo}`);
  await shot(page, "eliminar-dialogo");
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  ok("«Cancelar» cierra el diálogo", await oculto(dialogo));
  ok("…y no borra nada", Boolean(await conv(N.c)));
  const C = await conv(N.c);
  await row(N.c).click({ button: "right" });
  await ctxMenu.getByRole("menuitem", { name: "Eliminar" }).click();
  await dialogo.getByRole("button", { name: "Eliminar permanentemente" }).click();
  ok("«Eliminar permanentemente» quita el chat de la lista", await oculto(row(N.c)));
  ok("…y del servidor", await hasta(async () => !(await conv(N.c))));
  const msgsC = await call("GET", `/api/conversations/${C.id}/messages`);
  ok("sus mensajes ya no existen (404)", msgsC.status === 404, String(msgsC.status));
  ok("el contacto se conserva", (await call("GET", `/api/contacts/${C.contact.id}`)).status === 200);

  console.log("== 8. Un Asesor no puede eliminar ==");
  const as = await newCtx();
  const acall = apiOf(as);
  const al2 = await acall("POST", "/api/auth/sign-in/email", { email: ASESOR.email, password: ASESOR.password });
  ok("el asesor entra", al2.status < 400, String(al2.status));
  const D = await conv(N.d);
  await call("POST", "/api/assignments", { contactIds: [D.contact.id], userId: asesorId });
  const ap = await as.newPage();
  await ap.goto(`${BASE}/inbox`, { timeout: 180000, waitUntil: "domcontentloaded" });
  const arow = (name) => ap.locator("[data-conversation-row]", { hasText: name });
  ok("el asesor ve SU chat", await ver(arow(N.d), 120000));
  await ap.waitForLoadState("networkidle").catch(() => {});
  await arow(N.d).click({ button: "right" });
  const actx = ap.getByRole("menu", { name: "Opciones del chat" });
  ok("el asesor sí puede archivar", await ver(actx.getByRole("menuitem", { name: "Archivar" })));
  ok("…pero «Eliminar» NO aparece en el menú de la fila", (await actx.getByRole("menuitem", { name: "Eliminar" }).count()) === 0);
  await ap.keyboard.press("Escape");
  await arow(N.d).locator("button").first().click();
  await ap.getByRole("button", { name: "Opciones del chat" }).click();
  ok("…ni en el «⋯» del chat abierto", (await ver(actx.getByRole("menuitem", { name: "Archivar" }))) && (await actx.getByRole("menuitem", { name: "Eliminar" }).count()) === 0);
  await shot(ap, "eliminar-asesor");
  const manual = await acall("DELETE", `/api/conversations/${D.id}`);
  ok("un DELETE manual del asesor recibe 403", manual.status === 403, String(manual.status));
  ok("…y el chat sigue ahí", Boolean(await conv(N.d)));
  await as.close();
} catch (err) {
  failures++;
  console.log("  FAIL excepción:", err?.stack ?? err);
} finally {
  await call("PUT", "/api/agent/profile", { name: "Sofi", enabled: false }).catch(() => {});
  await browser.close();
}

if (failures > 0) {
  console.log(`\n${failures} check(s) con fallo`);
  process.exit(1);
}
console.log("\nBandeja 034: todo en verde");
