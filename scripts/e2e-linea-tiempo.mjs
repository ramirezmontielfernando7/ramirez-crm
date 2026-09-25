/**
 * Self-test E2E de 022 — sidebar colapsable por rol, panel de Detalles
 * reorganizado y línea de tiempo del chat (tests/e2e/us-linea-tiempo.md).
 *
 * Conduce la app REAL con tres personas a la vez (propietario, asesor A y
 * asesor B), por la API y por el navegador:
 *   - la línea de tiempo junta notas, asignación, etapa, pausa de la IA y
 *     consentimiento, con "[acción] por [quién]";
 *   - el asesor la ve COMPLETA (también lo de antes de que el chat fuera
 *     suyo) y el asesor ajeno recibe 404;
 *   - el asesor no entra a Resultados (403 / redirección) ni lo ve en el menú;
 *   - el menú arranca colapsado para el asesor y abierto para el propietario,
 *     se colapsa a mano y la preferencia persiste (BD, por usuario);
 *   - "Ver historial de asignación" solo para quien reparte; "Más detalles"
 *     plegado; orden del panel; "ver más" de una nota.
 *
 * Uso: app viva con los mocks (`pnpm dev`), después de `pnpm test:e2e` y
 * `pnpm test:e2e:roles` (crean al propietario y al equipo):
 *   node --env-file=.env scripts/e2e-linea-tiempo.mjs
 * Re-ejecutable (cada corrida usa un teléfono nuevo). Sale con 1 si algo falla.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const PN = "PN-E2E";
const OWNER = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
const A = { email: "asesor.a.e2e@vocero.test", password: "password-e2e-roles-123", name: "Asesor A E2E" };
const B = { email: "asesor.b.e2e@vocero.test", password: "password-e2e-roles-123" };

let fails = 0;
let checks = 0;
const ok = (n, c, x = "") => {
  checks++;
  console.log(`  ${c ? "OK  " : "FAIL"} ${n}${!c && x ? " — " + x : ""}`);
  if (!c) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 15000, paso = 300) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}

const browser = await chromium
  .launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" })
  .catch(() => chromium.launch());

/** Una persona: su propio contexto (cookies) y un cliente de API. */
async function persona(who) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.click('button[type="submit"]');
  const entro = await page.waitForURL(/inbox/, { timeout: 30000 }).then(() => true, () => false);
  const call = async (method, path, data) => {
    const res = await ctx.request.fetch(`${BASE}${path}`, {
      method,
      data,
      headers: { origin: BASE },
      maxRedirects: 0,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status(), json, headers: res.headers() };
  };
  return { ctx, page, errors, entro, call };
}

const owner = await persona(OWNER);
ok("el propietario inicia sesión", owner.entro);
const asesorA = await persona(A);
ok("el asesor A inicia sesión", asesorA.entro);
const asesorB = await persona(B);
ok("el asesor B inicia sesión", asesorB.entro);

// Cada quien vuelve al default de su rol (una corrida anterior pudo guardar otro).
for (const p of [owner, asesorA]) await p.call("PUT", "/api/preferences", { navCollapsed: null });

/* ── 1 · Un chat nuevo y su historia ─────────────────────────────── */
console.log("\n== 1 · Un chat nuevo, y todo lo que le pasa queda en su línea de tiempo ==");
await owner.call("PUT", "/api/settings/whatsapp", { wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" });
const phone = `5215577${RUN}`;
const inbound = await owner.call("POST", "/api/dev/wa-mock/inbound", {
  phoneNumberId: PN,
  from: phone,
  name: `Línea ${RUN}`,
  text: "hola, quiero información",
  waMessageId: `wamid.e2e.tl.${RUN}`,
});
ok("entrante (wa-mock)", inbound.status < 300, `status=${inbound.status}`);
let conv = null;
await hasta(async () => {
  const r = await owner.call("GET", "/api/conversations");
  conv = r.json?.conversations?.find((c) => c.contact?.name === `Línea ${RUN}`) ?? null;
  return Boolean(conv);
});
ok("el propietario ve la conversación", Boolean(conv));
const contactId = conv?.contact?.id;

const larga = `Quiere cotizar tres piezas. ${"Detalle importante de la cotización. ".repeat(6)}FIN-${RUN}`;
const nota = await owner.call("POST", `/api/contacts/${contactId}/notes`, { text: larga });
ok("POST nota → 201", nota.status === 201, `status=${nota.status}`);
const vacia = await owner.call("POST", `/api/contacts/${contactId}/notes`, { text: "   " });
ok("una nota vacía → 422", vacia.status === 422, `status=${vacia.status}`);

const team = (await owner.call("GET", "/api/settings/team")).json?.members ?? [];
const ID_A = team.find((m) => m.email === A.email)?.userId;
const asignar = await owner.call("POST", "/api/assignments", { contactIds: [contactId], userId: ID_A });
ok("el propietario asigna el chat al asesor A", asignar.status === 200, `status=${asignar.status}`);

const pausa = await owner.call("PATCH", `/api/conversations/${conv?.id}`, { aiEnabled: false });
ok("pausa la IA", pausa.status === 200, `status=${pausa.status}`);
await owner.call("PATCH", `/api/conversations/${conv?.id}`, { aiEnabled: true });
// Marcar leído NO es actividad.
await owner.call("PATCH", `/api/conversations/${conv?.id}`, { markRead: true });

const consent = await owner.call("PATCH", `/api/contacts/${contactId}`, {
  waConsent: "opt_in",
  waConsentSource: "Formulario E2E",
});
ok("marca el consentimiento", consent.status === 200, `status=${consent.status}`);

const stages = (await owner.call("GET", "/api/pipeline/stages")).json?.stages ?? [];
const detail = (await owner.call("GET", `/api/contacts/${contactId}`)).json;
const destino = stages.find((s) => s.kind === "open" && s.id !== detail?.stage?.id);
const mover = await owner.call("PATCH", `/api/pipeline/leads/${detail?.lead?.id}`, {
  stageId: destino?.id,
  position: 0,
});
ok("mueve el lead de etapa", mover.status === 200, `status=${mover.status}`);

const tl = (await owner.call("GET", `/api/contacts/${contactId}/timeline`)).json?.items ?? [];
const kinds = tl.map((i) => i.kind);
ok(
  "la línea de tiempo trae nota, asignación, pausa, reactivación, consentimiento y etapa",
  ["note", "assignment", "ai_paused", "ai_resumed", "consent", "stage"].every((k) => kinds.includes(k)),
  JSON.stringify(kinds)
);
ok("marcar leído no dejó rastro", kinds.filter((k) => k.startsWith("ai_")).length === 2, JSON.stringify(kinds));
ok(
  "lo más reciente primero",
  tl.every((it, i) => i === 0 || tl[i - 1].at >= it.at),
  JSON.stringify(tl.map((i) => i.at))
);
const notaItem = tl.find((i) => i.kind === "note");
ok("la nota lleva autor", notaItem?.actor?.name === OWNER.name, JSON.stringify(notaItem?.actor));
const pausaItem = tl.find((i) => i.kind === "ai_paused");
ok("la pausa de la IA lleva quién", pausaItem?.actor?.name === OWNER.name, JSON.stringify(pausaItem));

/* ── 2 · Quién ve qué ─────────────────────────────────────────────── */
console.log("\n== 2 · El asesor ve la historia completa de SU chat; el ajeno, nada ==");
const tlA = await asesorA.call("GET", `/api/contacts/${contactId}/timeline`);
ok("A (asignado) → 200", tlA.status === 200, `status=${tlA.status}`);
ok(
  "A ve también lo de ANTES de que fuera suyo (la nota del propietario)",
  (tlA.json?.items ?? []).some((i) => i.kind === "note" && i.detail?.text?.includes(`FIN-${RUN}`))
);
const tlB = await asesorB.call("GET", `/api/contacts/${contactId}/timeline`);
ok("B (ajeno) → 404", tlB.status === 404, `status=${tlB.status}`);
const notaB = await asesorB.call("POST", `/api/contacts/${contactId}/notes`, { text: "intruso" });
ok("B no puede anotar en el chat ajeno → 404", notaB.status === 404, `status=${notaB.status}`);

console.log("\n== 3 · Resultados: el asesor no entra ==");
const salesA = await asesorA.call("GET", "/api/analytics/sales");
ok("A → /api/analytics/sales: 403", salesA.status === 403, `status=${salesA.status}`);
const salesO = await owner.call("GET", "/api/analytics/sales");
ok("el propietario → 200", salesO.status === 200, `status=${salesO.status}`);

console.log("\n== 4 · Preferencia del menú: por usuario, en BD ==");
const p0 = await asesorA.call("GET", "/api/preferences");
ok("sin preferencia guardada → null (default del rol)", p0.json?.navCollapsed === null && p0.json?.navMode === null, JSON.stringify(p0.json));
await asesorA.call("PUT", "/api/preferences", { navCollapsed: false });
const p1 = await asesorA.call("GET", "/api/preferences");
ok("se guarda", p1.json?.navCollapsed === false, JSON.stringify(p1.json));
const pO = await owner.call("GET", "/api/preferences");
ok("…y es solo de quien la guardó", pO.json?.navCollapsed === null, JSON.stringify(pO.json));
const malo = await asesorA.call("PUT", "/api/preferences", { navCollapsed: "sí" });
ok("un valor inválido → 422", malo.status === 422, `status=${malo.status}`);
await asesorA.call("PUT", "/api/preferences", { navMode: "hidden" });
const p2 = await asesorA.call("GET", "/api/preferences");
ok(
  "el tercer estado (oculto) se guarda y deja coherente la preferencia vieja",
  p2.json?.navMode === "hidden" && p2.json?.navCollapsed === true,
  JSON.stringify(p2.json)
);
const malo2 = await asesorA.call("PUT", "/api/preferences", { navMode: "gigante" });
ok("un modo que no existe → 422", malo2.status === 422, `status=${malo2.status}`);
await asesorA.call("PUT", "/api/preferences", { navCollapsed: null });

/* ── 5 · Navegador: el propietario ──────────────────────────────── */
console.log("\n== 5 · Navegador — propietario ==");
const op = owner.page;
await op.goto(`${BASE}/inbox?contact=${contactId}`);
const aside = op.locator("aside").first();
const ancho = async (p) => (await p.locator("aside").first().boundingBox())?.width ?? 0;
await aside.waitFor();
ok("el menú arranca ABIERTO para el propietario", (await ancho(op)) > 200, `w=${await ancho(op)}`);
ok("y lleva a Resultados", (await op.locator('aside a[href="/results"]').count()) === 1);
const dur = await aside.evaluate((el) => getComputedStyle(el).transitionDuration);
ok(
  "la animación del menú no pasa de 300 ms",
  dur.split(",").every((d) => parseFloat(d) * (d.includes("ms") ? 1 : 1000) <= 300),
  dur
);
await op.getByRole("button", { name: "Colapsar el menú" }).click();
await hasta(async () => (await ancho(op)) < 80, 2000, 50);
ok("se colapsa a mano", (await ancho(op)) < 80, `w=${await ancho(op)}`);
await hasta(async () => (await owner.call("GET", "/api/preferences")).json?.navCollapsed === true, 3000);
await op.reload();
await aside.waitFor();
ok("y sigue colapsado al volver (persistió)", (await ancho(op)) < 80, `w=${await ancho(op)}`);
ok("colapsado, Resultados sigue ahí (íconos)", (await op.locator('aside a[href="/results"]').count()) === 1);
// `evaluate` y no `click()`: en `next dev` el indicador de desarrollo vive
// justo en la esquina inferior izquierda, encima del avatar colapsado.
await op.getByRole("button", { name: `${OWNER.name} · Propietario` }).evaluate((el) => el.click());
const perfil = op.getByRole("dialog", { name: "Tu perfil" });
ok("el avatar abre la tarjeta de perfil", await perfil.isVisible().catch(() => false));
ok("con nombre y rol", ((await perfil.innerText().catch(() => "")) || "").includes("Propietario"));
await op.keyboard.press("Escape");
// 022 — Tercer estado: oculto. El botón para volver queda fijo en la esquina.
await op.getByRole("button", { name: "Ocultar el menú" }).click();
await hasta(async () => !(await aside.isVisible()), 2000, 50);
ok("el tercer clic oculta el menú", !(await aside.isVisible()));
const revelar = op.getByRole("button", { name: "Mostrar el menú" });
await op.waitForTimeout(400); // que termine el deslizamiento de la columna
const caja = await revelar.boundingBox();
const titulo = await op.getByRole("heading", { name: "Bandeja" }).boundingBox();
const columna = await op
  .locator("header", { has: op.getByRole("heading", { name: "Bandeja" }) })
  .boundingBox();
ok(
  "oculto, el hamburguesa va en la fila del título, alineado con el texto",
  !!caja && !!titulo && (await revelar.isVisible()) &&
    Math.abs(caja.y + caja.height / 2 - (titulo.y + titulo.height / 2)) <= 2 &&
    caja.x + caja.width <= titulo.x,
  JSON.stringify({ caja, titulo })
);
ok(
  "…y la columna de la Bandeja ocupa el ancho que dejó el menú (sin franja)",
  !!columna && columna.x <= 1,
  JSON.stringify(columna)
);
await hasta(async () => (await owner.call("GET", "/api/preferences")).json?.navMode === "hidden", 3000);
ok("el estado oculto se guarda", (await owner.call("GET", "/api/preferences")).json?.navMode === "hidden");
await op.reload();
await revelar.waitFor();
ok("y sigue oculto al volver (persistió)", !(await aside.isVisible()));
await revelar.click();
await hasta(async () => (await ancho(op)) > 200, 2000, 50);
ok("el cuarto clic vuelve a expandido", (await ancho(op)) > 200);
await hasta(async () => (await revelar.count()) === 0, 2000, 50);
ok("…y el botón flotante se va", (await revelar.count()) === 0);

// Filtros de la Bandeja: una cápsula en la fila del título que despliega el
// resto; la selección múltiple, pegada a ella; sin la fila de cápsulas.
const capsula = op.getByRole("button", { name: /^Filtrar la bandeja/ });
const tituloB = await op.getByRole("heading", { name: "Bandeja" }).boundingBox();
const cajaCap = await capsula.boundingBox();
const cajaSel = await op.getByRole("button", { name: "Seleccionar varios" }).boundingBox();
const centro = (b) => b.y + b.height / 2;
ok(
  "filtros: la cápsula y «Seleccionar varios» van en la fila del título",
  !!tituloB && !!cajaCap && !!cajaSel &&
    Math.abs(centro(cajaCap) - centro(tituloB)) <= 2 &&
    Math.abs(centro(cajaSel) - centro(tituloB)) <= 2 &&
    cajaCap.x > tituloB.x && cajaSel.x > cajaCap.x,
  JSON.stringify({ tituloB, cajaCap, cajaSel })
);
ok("…y la fila de cápsulas ya no está", (await op.getByRole("button", { name: /^No leídas/ }).count()) === 0);
await capsula.click();
const panelF = op.getByRole("dialog", { name: "Filtros de la bandeja" });
await panelF.waitFor();
ok(
  "tocar la cápsula despliega Mostrar, Etapa y Quién atiende",
  (await panelF.getByRole("button", { name: /^No leídas/ }).count()) === 1 &&
    (await panelF.getByLabel("Filtrar por persona asignada").count()) === 1
);
await panelF.getByRole("button", { name: /^No leídas/ }).click();
await hasta(async () => (await panelF.count()) === 0, 2000, 50);
ok("elegir «No leídas» cierra el panel y la cápsula lo dice", (await panelF.count()) === 0 &&
  /No leídas/.test((await capsula.getAttribute("aria-label")) ?? ""));
await capsula.click();
await panelF.getByRole("button", { name: "Quitar filtros" }).click();
ok("«Quitar filtros» vuelve a Todas", /Todas/.test((await capsula.getAttribute("aria-label")) ?? ""));

// Panel de detalles.
const y = async (loc) => (await loc.first().boundingBox())?.y ?? -1;
const kAsign = op.locator("p.kicker", { hasText: "Asignación" });
const kEtapa = op.locator("p.kicker", { hasText: "Etapa del pipeline" });
const bMas = op.getByRole("button", { name: "Más detalles" });
const kAct = op.locator("p.kicker", { hasText: "Actividad" });
await kAct.first().waitFor({ timeout: 20000 });
const orden = [await y(kAsign), await y(kEtapa), await y(bMas), await y(kAct)];
ok(
  "orden: Asignación → Etapa → Más detalles → Actividad",
  orden.every((v, i) => v >= 0 && (i === 0 || orden[i - 1] < v)),
  JSON.stringify(orden)
);
ok(
  "«Más detalles» arranca plegado",
  (await op.getByText("Mensajes masivos (WhatsApp)").count()) === 0
);
await bMas.click();
await op.getByText("Mensajes masivos (WhatsApp)").waitFor({ timeout: 3000 });
const mas = [
  await y(op.getByText("Mensajes masivos (WhatsApp)")),
  await y(op.locator("p.kicker", { hasText: /^Etiquetas$/ })),
  await y(op.locator("p.kicker", { hasText: /Ficha/ })),
];
ok("dentro: Mensajes masivos → Etiquetas → Ficha", mas.every((v, i) => v >= 0 && (i === 0 || mas[i - 1] < v)), JSON.stringify(mas));

const verHist = op.getByRole("button", { name: "Ver historial de asignación" });
// El historial llega por su propia petición: se espera, no se supone.
await verHist.waitFor({ timeout: 15000 }).catch(() => {});
ok("el propietario tiene «Ver historial de asignación»", (await verHist.count()) === 1);
await verHist.click();
await hasta(async () => (await op.getByText(/Asignado a Asesor A E2E/).count()) > 0, 3000);
ok("al abrirlo muestra el historial", (await op.getByText(/Asignado a Asesor A E2E/).count()) > 0);

// Línea de tiempo en pantalla.
const actividad = op.getByRole("region", { name: "Actividad del chat" });
ok(
  "la actividad dice «Nota añadida por Operador E2E»",
  await hasta(async () => (await actividad.getByText(`Nota añadida por ${OWNER.name}`).count()) > 0, 5000)
);
ok(
  "«Reasignado/Asignado … por Operador E2E»",
  (await actividad.getByText(`Asignado a ${A.name} por ${OWNER.name}`).count()) > 0
);
ok(
  "«IA pausada en esta conversación por Operador E2E»",
  (await actividad.getByText(`IA pausada en esta conversación por ${OWNER.name}`).count()) > 0
);
const fila = actividad.locator("li", { hasText: "Nota añadida" }).first();
ok(
  "la nota larga se ve en UNA línea (recortada) de entrada",
  (await fila.locator("p.whitespace-pre-wrap").count()) === 0 && (await fila.locator("span.truncate").count()) === 1
);
await fila.getByRole("button", { name: "ver más" }).click();
await hasta(async () => (await fila.locator("p.whitespace-pre-wrap").count()) > 0, 2000, 50);
ok("«ver más» la abre en su lugar", (await fila.locator("p.whitespace-pre-wrap").innerText().catch(() => "")).includes(`FIN-${RUN}`));

// Añadir una nota desde el panel.
const texto = `Nota desde el panel ${RUN}`;
await actividad.getByRole("textbox", { name: "Nueva nota" }).fill(texto);
await actividad.getByRole("button", { name: "Añadir nota" }).click();
// Generoso a propósito: en `next dev` la primera escritura puede tardar
// segundos; en producción es inmediata.
ok(
  "el campo queda vacío al guardar",
  await hasta(async () => (await actividad.getByRole("textbox", { name: "Nueva nota" }).inputValue()) === "", 20000)
);
ok(
  "la nota nueva aparece arriba, sin recargar",
  await hasta(async () => ((await actividad.locator("li").first().innerText().catch(() => "")) || "").includes("Nota añadida"), 10000)
);

// Camino infeliz: la API falla → se dice y el borrador NO se pierde.
await op.route("**/api/contacts/*/notes", (r) =>
  r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal", message: "Error interno" } }) })
);
await actividad.getByRole("textbox", { name: "Nueva nota" }).fill("no se va a guardar");
await actividad.getByRole("button", { name: "Añadir nota" }).click();
ok(
  "si falla, el error se muestra",
  await hasta(async () => (await op.getByRole("alert").filter({ hasText: "No se guardó la nota" }).count()) > 0, 3000)
);
ok("y el borrador se conserva", (await actividad.getByRole("textbox", { name: "Nueva nota" }).inputValue()) === "no se va a guardar");
await op.unroute("**/api/contacts/*/notes");
await actividad.getByRole("textbox", { name: "Nueva nota" }).fill("");
ok("sin errores de JS (propietario)", owner.errors.length === 0, owner.errors.join(" | "));

/* ── 6 · Navegador: el asesor ───────────────────────────────────── */
console.log("\n== 6 · Navegador — asesor ==");
const ap = asesorA.page;
await ap.goto(`${BASE}/inbox?contact=${contactId}`);
await ap.locator("aside").first().waitFor();
ok("el menú arranca COLAPSADO para el asesor", (await ancho(ap)) < 80, `w=${await ancho(ap)}`);
ok("sin Resultados (colapsado)", (await ap.locator('a[href="/results"]').count()) === 0);
// El mismo ciclo de tres pasos para el asesor: íconos → oculto → expandido.
await ap.getByRole("button", { name: "Ocultar el menú" }).click();
await hasta(async () => !(await ap.locator("aside").first().isVisible()), 2000, 50);
ok("el asesor también puede ocultarlo", !(await ap.locator("aside").first().isVisible()));
await ap.getByRole("button", { name: "Mostrar el menú" }).click();
await hasta(async () => (await ancho(ap)) > 200, 2000, 50);
ok("el asesor lo expande", (await ancho(ap)) > 200);
ok("sin Resultados (expandido)", (await ap.locator('a[href="/results"]').count()) === 0);
await ap.getByRole("button", { name: "Colapsar el menú" }).click();
const actA = ap.getByRole("region", { name: "Actividad del chat" });
await actA.waitFor({ timeout: 20000 });
ok("el asesor NO tiene «Ver historial de asignación»", (await ap.getByRole("button", { name: /historial de asignación/ }).count()) === 0);
// Lo de antes puede quedar debajo de las primeras 8 líneas: se piden las
// anteriores si hace falta, como lo haría la persona.
const verAnteriores = actA.getByRole("button", { name: /Ver anteriores/ });
await actA.locator("li").first().waitFor({ timeout: 15000 }).catch(() => {});
if (await verAnteriores.count()) await verAnteriores.click();
ok(
  "pero su línea de tiempo trae la asignación y lo de antes",
  await hasta(
    async () =>
      (await actA.getByText(`Asignado a ${A.name} por ${OWNER.name}`).count()) > 0 &&
      (await actA.getByText(`Nota añadida por ${OWNER.name}`).count()) > 0,
    10000
  ),
  (await actA.locator("li p").allInnerTexts()).join(" | ")
);
ok("el toggle de IA sigue en su lugar", (await ap.getByRole("switch", { name: "IA en esta conversación" }).count()) === 1);
await ap.goto(`${BASE}/results`);
ok("/results → de vuelta a la Bandeja", /\/inbox/.test(ap.url()), ap.url());
ok("sin errores de JS (asesor)", asesorA.errors.length === 0, asesorA.errors.join(" | "));

// Deja todo como estaba.
for (const p of [owner, asesorA]) await p.call("PUT", "/api/preferences", { navCollapsed: null });
await browser.close();
console.log(`\n===== ${checks - fails}/${checks} checks OK, ${fails} fallos =====`);
process.exit(fails ? 1 : 0);
