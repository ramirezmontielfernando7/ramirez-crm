/**
 * Self-test E2E de 031 — Laboratorio como Centro de Agentes
 * (tests/e2e/us-agentes.md). Contra la app real con mocks.
 *
 * PR A1 (sin pantallas nuevas: todo por la API, como lo hará la UI de A2):
 *  1. El negocio tiene su agente GENERAL (el de siempre, publicado) y
 *     `/api/agent/profile` conserva su forma.
 *  2. Crear un agente SIN nombre → la vista previa responde con la config del
 *     formulario SIN guardar («¿quién eres?» → «sin nombre propio»), muestra
 *     las acciones como chips («lo compro» → «Movería a Interesado»), escala
 *     con el patrón de respaldo, y NADA sale a WhatsApp ni se guarda.
 *  3. Borrador vs. publicado: guardar no publica; publicar deja versión;
 *     restaurar la carga al borrador.
 *  4. Evaluar ese agente (borrador) en el Laboratorio: la corrida registra
 *     qué agente y qué versión se evaluó.
 *  5. Producción idéntica: un mensaje real lo contesta el GENERAL, con su
 *     nombre de siempre.
 *  6. Límite de la vista previa (31.ª en el minuto → 429) y archivar.
 *
 * PR A2 (pantallas, con navegador real — sección 5b):
 *  - «Agente» sale del menú con Laboratorio encendido y /agent sigue vivo con
 *    su enlace a «Gestionar todos los agentes».
 *  - /lab (Agentes): el general fijo arriba; crear un agente desde la pantalla;
 *    vista previa tipo chat con chips y «Por qué respondió así»; guardar
 *    borrador, publicar (con resumen), renombrar, cargar una versión al
 *    borrador, y el aviso del cerebro externo al «Hacer general».
 *  - /lab/evaluaciones: el selector de agente lista al agente nuevo.
 *  - La vista previa NO manda nada a WhatsApp (outbox vacío); archivar desde
 *    la lista.
 *
 * Uso: app viva con WA_MOCK_ENABLED=true y los mocks (ai-mock, wa-mock):
 *   node --env-file=.env scripts/e2e-agentes.mjs
 * Re-ejecutable (cada corrida archiva lo que crea). Sale con 1 si algo falla.
 */
import postgres from "postgres";
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const ADMIN = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
const PN_AGT = `PN-E2E-AGT-${RUN}`;

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
async function hasta(cond, ms = 30000) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(500);
  }
}

const sql = postgres(process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL, { max: 2, onnotice: () => {} });

let cookie = "";
async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      origin: BASE,
      "x-forwarded-for": `10.31.${Number(RUN.slice(-3)) % 256}.7`,
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
    redirect: "manual",
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // no es JSON
  }
  return { status: res.status, json, text };
}
const post = (path, body) => api(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const put = (path, body) => api(path, { method: "PUT", body: JSON.stringify(body) });

async function main() {
  console.log("== Setup ==");
  let login = await post("/api/auth/sign-in/email", { email: ADMIN.email, password: ADMIN.password });
  if (login.status >= 400) {
    await post("/api/auth/sign-up/email", ADMIN);
    login = await post("/api/auth/sign-in/email", { email: ADMIN.email, password: ADMIN.password });
  }
  ok("el Propietario entra", login.status < 400, String(login.status));
  const [{ organization_id: org } = {}] = await sql`
    select m.organization_id from member m join "user" u on u.id = m.user_id where u.email = ${ADMIN.email}`;
  ok("su organización existe", Boolean(org));

  console.log("\n== 1. El agente general de siempre ==");
  const lista = await api("/api/lab/agents");
  ok("GET /api/lab/agents", lista.status === 200, lista.text.slice(0, 200));
  const general = (lista.json?.agents ?? []).find((a) => a.isGeneral);
  ok("hay exactamente un agente general, publicado", (lista.json?.agents ?? []).filter((a) => a.isGeneral).length === 1 && general?.publishedAt);
  const perfil = await api("/api/agent/profile");
  const p = perfil.json?.profile ?? {};
  ok(
    "/api/agent/profile conserva su forma (y solo crece)",
    perfil.status === 200 && ["enabled", "name", "tone", "instructions", "escalationRules", "greeting"].every((k) => k in p) && "displayName" in p,
    perfil.text.slice(0, 200)
  );

  console.log("\n== 2. Agente nuevo sin nombre + vista previa ==");
  const creado = await post("/api/lab/agents", { internalName: `Ventas E2E ${RUN}` });
  const agente = creado.json?.agent;
  ok("crear agente → 201, borrador sin nombre", creado.status === 201 && agente?.status === "draft" && agente?.draft?.displayName === null, creado.text.slice(0, 200));

  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  const [antes] = await sql`
    select (select count(*) from message where organization_id = ${org})::int as m,
           (select count(*) from lead where organization_id = ${org})::int as l,
           (select count(*) from conversation where organization_id = ${org})::int as c`;
  const formulario = { displayName: "", tone: "Muy breve", useSharedKb: true };
  const quien = await post("/api/lab/preview", { agentId: agente?.id, config: formulario, history: [], message: "hola, ¿quién eres?" });
  ok(
    "vista previa con la config del formulario (sin guardar): habla sin nombre propio",
    quien.status === 200 && /sin nombre propio/.test(quien.json?.reply ?? ""),
    quien.text.slice(0, 200)
  );
  const compra = await post("/api/lab/preview", {
    agentId: agente?.id,
    config: formulario,
    history: [{ role: "user", text: "hola, ¿quién eres?" }, { role: "assistant", text: quien.json?.reply ?? "hola" }],
    message: "lo compro",
  });
  ok(
    "las acciones salen como chips («Movería a Interesado»)",
    compra.status === 200 && (compra.json?.chips ?? []).some((c) => c.kind === "move_stage" && /Interesado/.test(c.label)),
    compra.text.slice(0, 300)
  );
  ok("«Por qué respondió así»: acción y entradas de KB", compra.json?.debug?.action === "move_stage" && Array.isArray(compra.json?.debug?.kbEntryIds));
  const humano = await post("/api/lab/preview", { agentId: agente?.id, config: formulario, history: [], message: "quiero hablar con un asesor" });
  ok("pedir una persona → escalaría (sin gastar IA)", humano.json?.escalated === true && humano.json?.chips?.[0]?.kind === "handoff", humano.text.slice(0, 200));
  const outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  ok("NADA salió a WhatsApp", outbox.length === 0, JSON.stringify(outbox).slice(0, 200));
  const [despues] = await sql`
    select (select count(*) from message where organization_id = ${org})::int as m,
           (select count(*) from lead where organization_id = ${org})::int as l,
           (select count(*) from conversation where organization_id = ${org})::int as c`;
  ok("NADA se guardó (mensajes, leads, conversaciones)", JSON.stringify(antes) === JSON.stringify(despues), `${JSON.stringify(antes)} → ${JSON.stringify(despues)}`);
  const sinGuardar = await api(`/api/lab/agents/${agente?.id}`);
  ok("la vista previa no guardó el formulario", sinGuardar.json?.agent?.draft?.tone === null);

  console.log("\n== 3. Borrador, publicar, versiones ==");
  const guardado = await put(`/api/lab/agents/${agente?.id}/draft`, { ...formulario, instructions: "Versión 1" });
  ok("guardar borrador", guardado.status === 200 && guardado.json?.agent?.status === "draft", guardado.text.slice(0, 200));
  const pub = await post(`/api/lab/agents/${agente?.id}/publish`);
  ok("publicar", pub.status === 200 && pub.json?.agent?.status === "published" && pub.json?.agent?.published?.instructions === "Versión 1", pub.text.slice(0, 200));
  await put(`/api/lab/agents/${agente?.id}/draft`, { ...formulario, instructions: "Versión 2" });
  const cambios = await api(`/api/lab/agents/${agente?.id}`);
  ok("editar después de publicar → «Cambios sin publicar»", cambios.json?.agent?.status === "changes" && cambios.json?.agent?.published?.instructions === "Versión 1");
  const versiones = await api(`/api/lab/agents/${agente?.id}/versions`);
  const v1 = (versiones.json?.versions ?? []).find((v) => v.action === "publish");
  ok("el historial guarda la versión publicada", Boolean(v1) && v1.snapshot?.instructions === "Versión 1");
  const rest = await post(`/api/lab/agents/${agente?.id}/versions/${v1?.id}/restore`);
  ok(
    "restaurar la carga al BORRADOR (producción no cambia)",
    rest.status === 200 && rest.json?.agent?.draft?.instructions === "Versión 1" && rest.json?.agent?.published?.instructions === "Versión 1",
    rest.text.slice(0, 200)
  );
  const generalNoArchiva = await api(`/api/lab/agents/${general?.id}`, { method: "DELETE" });
  ok("el general no se archiva (409 agent_general)", generalNoArchiva.status === 409 && generalNoArchiva.json?.error?.code === "agent_general");

  console.log("\n== 4. Evaluar este agente (borrador) ==");
  let corrida = await post("/api/lab/runs", { agentId: agente?.id, source: "draft" });
  for (let i = 0; i < 30 && corrida.status === 409 && corrida.json?.error?.code === "run_in_progress"; i++) {
    await sleep(2000);
    corrida = await post("/api/lab/runs", { agentId: agente?.id, source: "draft" });
  }
  ok("POST /api/lab/runs con agente y fuente → 202", corrida.status === 202, corrida.text.slice(0, 200));
  const terminada = await hasta(async () => {
    const r = (await api(`/api/lab/runs/${corrida.json?.runId}`)).json?.run;
    return r && r.status !== "running";
  }, 240000);
  ok("la corrida termina", terminada);
  const runs = (await api("/api/lab/runs")).json?.runs ?? [];
  const mia = runs.find((r) => r.id === corrida.json?.runId);
  ok("el historial dice qué se evaluó", mia?.agentId === agente?.id && mia?.source === "draft" && mia?.agentName === `Ventas E2E ${RUN}`, JSON.stringify(mia));
  const sinCuerpo = await post("/api/lab/runs");
  if (sinCuerpo.status === 202) {
    await hasta(async () => (await api(`/api/lab/runs/${sinCuerpo.json?.runId}`)).json?.run?.status !== "running", 240000);
  }
  ok("POST /api/lab/runs sin cuerpo sigue funcionando (el general publicado)", sinCuerpo.status === 202 || sinCuerpo.json?.error?.code === "run_in_progress", sinCuerpo.text.slice(0, 200));
  const lista2 = (await api("/api/lab/agents")).json?.agents ?? [];
  ok("la tarjeta del agente muestra su última evaluación", lista2.find((a) => a.id === agente?.id)?.lastRun !== null);

  console.log("\n== 5. Producción idéntica: responde el general ==");
  const [cred] = await sql`select phone_number_id from meta_credentials where organization_id = ${org} limit 1`;
  let pn = cred?.phone_number_id;
  if (!pn) {
    const conn = await put("/api/settings/whatsapp", { wabaId: `WABA-E2E-AGT-${RUN}`, phoneNumberId: PN_AGT, token: "tok-e2e-agt" });
    ok("conectar WhatsApp de prueba", conn.status < 400, conn.text.slice(0, 200));
    pn = PN_AGT;
  }
  const encendidoAntes = perfil.json?.profile?.enabled;
  await put("/api/agent/profile", { enabled: true });
  const nombreGeneral = (await api("/api/agent/profile")).json?.profile;
  const tel = `52155${RUN}31`;
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  await post("/api/dev/wa-mock/inbound", { phoneNumberId: pn, from: tel, name: `Cliente Agentes ${RUN}`, text: "hola, ¿quién eres?", waMessageId: `wamid.agt.${RUN}` });
  let respuesta = null;
  await hasta(async () => {
    const out = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
    respuesta = out.find((o) => o.to === tel) ?? null;
    return respuesta;
  }, 45000);
  const esperado = nombreGeneral?.displayName ? `Soy ${nombreGeneral.displayName}.` : "Somos el equipo del negocio (sin nombre propio).";
  const textoRespuesta = JSON.stringify(respuesta ?? {});
  ok("un mensaje real lo contesta el agente GENERAL (no el del Laboratorio)", textoRespuesta.includes(esperado), textoRespuesta.slice(0, 300));
  await put("/api/agent/profile", { enabled: Boolean(encendidoAntes) });

  console.log("\n== 5b. Pantallas (navegador real) ==");
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    page.setDefaultTimeout(60000);
    const nombreUi = `UI E2E ${RUN}`;
    await page.goto(`${BASE}/login`);
    await page.fill("input[type=email]", ADMIN.email);
    await page.fill("input[type=password]", ADMIN.password);
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));

    // Menú: con Laboratorio (encendido por defecto en la demo) no hay «Agente».
    await page.goto(`${BASE}/lab`);
    await page.getByText(/de 20 agentes/).waitFor();
    ok("el menú tiene Laboratorio y ya no «Agente»", (await page.locator('nav a[href="/lab"]').count()) > 0 && (await page.locator('nav a[href="/agent"]').count()) === 0);
    ok("la lista fija al agente general arriba, con su insignia", /General/.test((await page.locator("ul > li").first().innerText()) ?? ""));

    // /agent sigue vivo y enlaza al Laboratorio.
    await page.goto(`${BASE}/agent`);
    await page.getByText("Agente de IA").first().waitFor();
    ok("/agent sigue editando al general y enlaza al Laboratorio", (await page.getByRole("link", { name: /Gestionar todos los agentes/ }).count()) === 1);

    // Crear desde la pantalla.
    await page.goto(`${BASE}/lab`);
    await page.getByRole("button", { name: "Crear agente" }).click();
    await page.fill("#new-agent-name", nombreUi);
    await page.getByRole("button", { name: "Crear y abrir" }).click();
    await page.waitForURL(/\/lab\/agents\//);
    await page.getByText(nombreUi).first().waitFor();
    const idUi = page.url().split("/lab/agents/")[1];
    ok("crear un agente lo abre en el editor (borrador, sin nombre de presentación)", Boolean(idUi) && (await page.locator("#agent-display-name").inputValue()) === "");

    // Vista previa con lo que hay en el formulario (sin guardar).
    await page.fill("#lab-agent-instructions", "Atiende con calidez.");
    await page.fill("#preview-input", "hola, ¿quién eres?");
    await page.keyboard.press("Enter");
    await page.getByText(/sin nombre propio/).first().waitFor();
    ok("la vista previa responde en el chat con la config sin guardar", true);
    await page.fill("#preview-input", "lo compro");
    await page.keyboard.press("Enter");
    await page.getByText("Movería a Interesado").waitFor();
    ok("las acciones salen como chips en la vista previa", true);
    await page.getByText("Por qué respondió así").first().click();
    ok("«Por qué respondió así» se despliega", (await page.getByText("Conocimiento usado").count()) > 0);
    ok("Sandbox: la vista previa avisa que no se envía a WhatsApp", (await page.getByText(/no se envía a WhatsApp/).count()) > 0);
    const outbox = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
    ok("la vista previa no mandó nada a WhatsApp", outbox.length === 0, JSON.stringify(outbox).slice(0, 200));
    await page.getByRole("button", { name: "Reiniciar" }).click();
    ok("Reiniciar vacía la conversación de prueba", (await page.getByText(/Escribe como si fueras un cliente/).count()) === 1);

    // Borrador → publicar (con resumen).
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    await page.getByText(/Borrador guardado/).waitFor();
    const trasGuardar = (await api(`/api/lab/agents/${idUi}`)).json?.agent;
    ok("guardar borrador no publica", trasGuardar?.status === "draft" && trasGuardar?.published === null, JSON.stringify(trasGuardar?.status));
    await page.getByRole("button", { name: "Publicar", exact: true }).click();
    await page.getByRole("dialog").getByText(/primera vez/).waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "Publicar" }).click();
    await page.getByText(/^Publicado\.$/).waitFor();
    const trasPublicar = (await api(`/api/lab/agents/${idUi}`)).json?.agent;
    ok("publicar desde la pantalla deja el agente publicado", trasPublicar?.status === "published" && Boolean(trasPublicar?.published));

    // Renombrar.
    await page.getByRole("button", { name: "Renombrar" }).click();
    await page.fill("#agent-internal-name", `${nombreUi} v2`);
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.getByText(`${nombreUi} v2`).first().waitFor();
    ok("renombrar el nombre interno", (await api(`/api/lab/agents/${idUi}`)).json?.agent?.internalName === `${nombreUi} v2`);

    // Cambiar, guardar y restaurar la versión publicada AL BORRADOR (D8).
    await page.fill("#lab-agent-instructions", "Texto que luego se revierte.");
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    await page.getByText(/Borrador guardado/).waitFor();
    await page.getByText("Historial de versiones").click();
    await page.getByRole("button", { name: "Cargar al borrador" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Cargar al borrador" }).click();
    await page.getByText(/Versión cargada en el borrador/).waitFor();
    const trasRestaurar = (await api(`/api/lab/agents/${idUi}`)).json?.agent;
    ok(
      "restaurar carga al BORRADOR y no toca lo publicado",
      trasRestaurar?.draft?.instructions === "Atiende con calidez." && trasRestaurar?.published?.instructions === "Atiende con calidez."
    );

    // Hacer general: advierte del cerebro externo y, al cancelar, no cambia nada.
    await page.getByText("Más opciones").click();
    await page.getByRole("button", { name: "Hacer general" }).click();
    ok("«Hacer general» avisa que cambia lo que recibe el cerebro externo", (await page.getByRole("dialog").getByText(/cerebro externo/).count()) > 0);
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
    const generales = ((await api("/api/lab/agents")).json?.agents ?? []).filter((a) => a.isGeneral);
    ok("cancelar deja al mismo general", generales.length === 1 && generales[0].id !== idUi);

    // Evaluaciones: el selector lista al agente.
    await page.goto(`${BASE}/lab/evaluaciones`);
    await page.getByLabel("Agente a evaluar").waitFor();
    const opcion = page.locator("#eval-agent option", { hasText: `${nombreUi} v2` });
    await opcion.waitFor({ state: "attached" });
    ok("/lab/evaluaciones ofrece al agente nuevo en el selector", (await opcion.count()) === 1);

    // Archivar desde la lista.
    await page.goto(`${BASE}/lab`);
    await page.getByRole("link", { name: new RegExp(`${nombreUi} v2`) }).waitFor();
    await page.locator("li", { hasText: `${nombreUi} v2` }).getByRole("button", { name: "Archivar" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archivar" }).click();
    await page.getByRole("link", { name: new RegExp(`${nombreUi} v2`) }).waitFor({ state: "detached" });
    ok("archivar desde la lista", !((await api("/api/lab/agents")).json?.agents ?? []).some((a) => a.id === idUi));
  } finally {
    await browser.close();
  }

  console.log("\n== 6. Límite de la vista previa y limpieza ==");
  let limitado = null;
  for (let i = 0; i < 40; i++) {
    const r = await post("/api/lab/preview", { agentId: agente?.id, config: formulario, history: [], message: "hola" });
    if (r.status === 429) {
      limitado = r;
      break;
    }
  }
  ok("la vista previa frena a 30 por minuto (429 preview_rate_limited)", limitado?.json?.error?.code === "preview_rate_limited", limitado?.text?.slice(0, 200) ?? "nunca 429");
  const arch = await api(`/api/lab/agents/${agente?.id}`, { method: "DELETE" });
  ok("archivar el agente de prueba", arch.status === 200);
  const fin = (await api("/api/lab/agents")).json?.agents ?? [];
  ok("ya no aparece en la lista", !fin.some((a) => a.id === agente?.id));
}

try {
  await main();
} catch (err) {
  failures++;
  console.error("ERROR", err);
} finally {
  await sql.end();
}
console.log(`\n${checks - failures}/${checks} verificaciones OK`);
if (failures > 0) {
  console.log("Fallaron:\n - " + fallas.join("\n - "));
  process.exit(1);
}
