/**
 * Self-test E2E — «Número no registrado» en la búsqueda de la Bandeja
 * (tests/e2e/us-numero-nuevo.md). Contra la app real con los mocks:
 *
 *  1. Buscar un teléfono que no existe → tarjeta «Este número no está
 *     registrado» (con el número normalizado). Un texto que no es teléfono
 *     deja el mensaje de siempre.
 *  2. «Registrar contacto» (sin nombre): el contacto queda con el teléfono
 *     como nombre y su lead; repetir con otro formato NO lo duplica.
 *  3. «Abrir chat»: conversación vacía, sin ventana → el compositor muestra
 *     «La ventana de 24 horas está cerrada» y NO hay cuadro de texto libre.
 *  4. «Enviar mensaje»: aviso de WhatsApp, «No lo sé» no deja enviar; «Sí»
 *     deja elegir la plantilla aprobada y sale por el wa-mock (se comprueba
 *     en su outbox); queda opt_in. Una plantilla pendiente no se ofrece.
 *  5. Camino infeliz: sin consentimiento la API responde 403 y no sale nada.
 *
 * Uso: app viva con WA_MOCK_ENABLED=true y los mocks (corre antes
 * pnpm test:e2e). Con SHOTS_DIR=<carpeta> guarda capturas.
 *   node --env-file=.env scripts/e2e-numero-nuevo.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR ?? null;
const RUN = Date.now().toString().slice(-7);
const ADMIN = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
// 10 dígitos de México, únicos por corrida.
const LOCAL = `55${RUN.padStart(8, "0")}`;
const CANON = `52${LOCAL}`;
const LOCAL2 = `56${RUN.padStart(8, "0")}`;
const CANON2 = `52${LOCAL2}`;
const TPL_OK = `bienvenida_${RUN}`;
const TPL_PEND = `pendiente_${RUN}`;

let failures = 0;
function ok(name, cond, extra = "") {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** `next dev` compila cada ruta la primera vez: se ESPERA, no se supone. */
const ver = (loc, ms = 60000) =>
  loc.first().waitFor({ state: "visible", timeout: ms }).then(() => true, () => false);
async function hasta(cond, ms = 60000) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond().catch(() => false)) return true;
    if (Date.now() > fin) return false;
    await sleep(400);
  }
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
);
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "es-MX",
  extraHTTPHeaders: { origin: BASE },
});
const call = async (method, path, body) => {
  const res = await ctx.request.fetch(`${BASE}${path}`, {
    method,
    data: body,
    failOnStatusCode: false,
    timeout: 180000,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // no es JSON
  }
  return { status: res.status(), json };
};
const shot = async (p, name) => {
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` });
};
const outbox = async () => (await call("GET", "/api/dev/wa-mock/outbox")).json?.outbox ?? [];

try {
  console.log("== Setup ==");
  let login = await call("POST", "/api/auth/sign-up/email", ADMIN);
  if (login.status >= 400) login = await call("POST", "/api/auth/sign-in/email", ADMIN);
  ok("el operador entra", login.status < 400, String(login.status));
  const conn = await call("PUT", "/api/settings/whatsapp", {
    wabaId: "WABA-E2E",
    phoneNumberId: "PN-E2E-1",
    token: "tok-e2e",
  });
  ok("número de WhatsApp conectado (wa-mock)", conn.status < 400, String(conn.status));

  for (const name of [TPL_OK, TPL_PEND]) {
    const t = await call("POST", "/api/templates", {
      name,
      language: "es_MX",
      category: "UTILITY",
      body: "Hola {{1}}, gracias por escribirnos.",
    });
    ok(`plantilla ${name} creada`, t.status === 201, JSON.stringify(t.json));
  }
  await call("POST", "/api/dev/wa-mock/template-status", {
    wabaId: "WABA-E2E",
    name: TPL_OK,
    language: "es_MX",
    event: "APPROVED",
    notify: false,
  });
  await call("POST", "/api/templates/sync");

  const page = await ctx.newPage();
  await page.goto(`${BASE}/inbox`, { timeout: 180000 });
  const buscar = async (texto) => {
    const campo = page.getByLabel("Buscar conversación", { exact: true });
    if (!(await campo.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: /Buscar conversación/ }).click();
    }
    await campo.fill(texto);
  };

  console.log("== 1. La búsqueda ==");
  await buscar("Persona inexistente");
  const mensajeDeSiempre = await ver(
    page.getByText(/Sin resultados para este filtro\.|Sin conversaciones todavía/)
  );
  ok(
    "un texto que no es teléfono NO muestra la tarjeta (queda el mensaje de siempre)",
    mensajeDeSiempre && (await page.getByText("Este número no está registrado").count()) === 0
  );
  await buscar(`${LOCAL.slice(0, 2)} ${LOCAL.slice(2, 6)} ${LOCAL.slice(6)}`);
  const tarjeta = page.getByText("Este número no está registrado");
  ok("un teléfono nuevo muestra la tarjeta", await ver(tarjeta));
  ok(
    "con el número normalizado (+52)",
    await ver(page.getByText(`+52 ${LOCAL.slice(0, 2)} ${LOCAL.slice(2, 6)} ${LOCAL.slice(6)}`))
  );
  ok(
    "los tres botones",
    (await ver(page.getByRole("button", { name: "Registrar contacto" }))) &&
      (await ver(page.getByRole("button", { name: "Abrir chat" }))) &&
      (await ver(page.getByRole("button", { name: "Enviar mensaje" })))
  );
  await shot(page, "numero-nuevo-1-tarjeta");

  console.log("== 2. Registrar contacto (sin nombre) ==");
  await page.getByRole("button", { name: "Registrar contacto" }).click();
  ok("el popup muestra el número que se guardará", await ver(page.getByText(`Se guardará como +52 ${LOCAL.slice(0, 2)}`)));
  await shot(page, "numero-nuevo-2-registrar");
  await page.getByRole("button", { name: "Guardar" }).click();
  ok(
    "queda registrado y la tarjeta lo muestra",
    await ver(page.getByText("Contacto registrado"))
  );
  await shot(page, "numero-nuevo-3-registrado");
  let contactos = [];
  await hasta(async () => {
    contactos = (await call("GET", `/api/contacts?q=${LOCAL}`)).json?.contacts ?? [];
    return contactos.length > 0;
  });
  ok("hay UN contacto con ese número", contactos.length === 1, JSON.stringify(contactos.map((c) => c.phone)));
  ok("su nombre es el teléfono (nunca vacío)", contactos[0]?.name === CANON, contactos[0]?.name);
  ok("con consentimiento sin confirmar", contactos[0]?.waConsent === "desconocido");
  const otra = await call("POST", "/api/inbox/new-number/register", { phone: `+52 1 ${LOCAL}` });
  ok(
    "otro formato (+52 1 …) NO lo duplica",
    otra.status === 200 && otra.json?.created === false && otra.json?.contact?.id === contactos[0]?.id,
    JSON.stringify(otra.json)
  );

  console.log("== 3. Abrir chat (sin ventana) ==");
  await page.getByRole("button", { name: "Abrir chat" }).click();
  ok(
    "abre el hilo con el aviso de ventana cerrada",
    await ver(page.getByText("La ventana de 24 horas está cerrada."))
  );
  ok("sin cuadro de texto libre", (await page.getByPlaceholder("Escribe una respuesta…").count()) === 0);
  ok("ofrece plantillas", await ver(page.locator("#template-select")));
  ok("el encabezado muestra el teléfono como nombre", await ver(page.getByText(`+${CANON}`)));
  await shot(page, "numero-nuevo-4-chat");
  const convId = (await call("GET", "/api/conversations")).json?.conversations?.find((c) => c.contact.phone === CANON)?.id;
  ok("la conversación vacía existe", Boolean(convId));
  const libre = await call("POST", `/api/conversations/${convId}/messages`, { text: "hola" });
  ok("el servidor rechaza texto libre sin ventana", libre.status >= 400 && libre.status < 500, String(libre.status));

  console.log("== 4. Enviar mensaje ==");
  await call("DELETE", "/api/dev/wa-mock/outbox");
  await page.goto(`${BASE}/inbox`, { timeout: 180000 });
  await buscar(`+52 ${LOCAL2}`);
  await page.getByRole("button", { name: "Enviar mensaje" }).click();
  ok(
    "muestra el aviso de WhatsApp",
    await ver(
      page.getByText("WhatsApp solo permite escribir primero con una plantilla aprobada, y solo a personas que aceptaron recibir mensajes de tu negocio.")
    )
  );
  await page.getByLabel("No lo sé").check();
  ok("«No lo sé» no ofrece enviar", (await page.locator("#template-select").count()) === 0);
  await page.getByLabel("Sí, aceptó").check();
  await ver(page.locator("#template-select"));
  const opciones = await page.locator("#template-select option").allTextContents();
  ok("ofrece la plantilla aprobada", opciones.some((o) => o.includes(TPL_OK)), JSON.stringify(opciones));
  ok("NO ofrece la pendiente", !opciones.some((o) => o.includes(TPL_PEND)));
  await page.locator("#template-select").selectOption({ label: opciones.find((o) => o.includes(TPL_OK)) });
  await page.getByLabel(/Valor de/).fill("Lupita");
  ok("vista previa con la variable puesta", await ver(page.getByText("Hola Lupita, gracias por escribirnos.")));
  await shot(page, "numero-nuevo-5-enviar");
  await page.getByRole("button", { name: "Enviar plantilla" }).click();
  const salio = async () =>
    (await outbox()).filter((m) => m.type === "template" && m.to === CANON2 && m.body?.template?.name === TPL_OK);
  let enviados = [];
  for (let i = 0; i < 30 && enviados.length === 0; i++) {
    await sleep(500);
    enviados = await salio();
  }
  ok("la plantilla llegó a Meta (outbox del mock) exactamente una vez", enviados.length === 1, JSON.stringify(enviados));
  ok(
    "al terminar abre el chat",
    await ver(page.getByText("La ventana de 24 horas está cerrada."))
  );
  const c2 = ((await call("GET", `/api/contacts?q=${LOCAL2}`)).json?.contacts ?? [])[0];
  ok("queda con consentimiento (opt_in)", c2?.waConsent === "opt_in", JSON.stringify(c2));
  await shot(page, "numero-nuevo-6-enviado");

  console.log("== 5. Camino infeliz: sin consentimiento nada sale ==");
  await call("DELETE", "/api/dev/wa-mock/outbox");
  const sin = await call("POST", "/api/inbox/new-number/send", {
    phone: `57${RUN.padStart(8, "0")}`,
    templateId: (await call("GET", "/api/templates")).json.templates.find((t) => t.name === TPL_OK).id,
    variables: ["Ana"],
    consentAnswer: "unknown",
  });
  ok("«No lo sé» por la API → 403", sin.status === 403 && sin.json?.error?.code === "consent_required", JSON.stringify(sin.json));
  await sleep(500);
  ok("y no salió nada a Meta", (await outbox()).length === 0);
  const mala = await call("POST", "/api/inbox/new-number/register", { phone: "12345" });
  ok("un teléfono inválido → 422 en español", mala.status === 422 && mala.json?.error?.code === "invalid_phone", JSON.stringify(mala.json));

  console.log("== 6. Celular ==");
  const cel = await browser.newContext({
    viewport: { width: 390, height: 780 },
    locale: "es-MX",
    extraHTTPHeaders: { origin: BASE },
    storageState: await ctx.storageState(),
  });
  const pc = await cel.newPage();
  await pc.goto(`${BASE}/inbox`, { timeout: 180000 });
  const campo = pc.getByLabel("Buscar conversación", { exact: true });
  if (!(await campo.isVisible().catch(() => false))) await pc.getByRole("button", { name: /Buscar conversación/ }).click();
  await campo.fill(`58${RUN.padStart(8, "0")}`);
  await pc.getByRole("button", { name: "Registrar contacto" }).click();
  await shot(pc, "numero-nuevo-7-celular");
  const caja = await pc.getByRole("dialog").boundingBox();
  ok("en celular el popup cabe en la pantalla", !!caja && caja.x >= 0 && caja.x + caja.width <= 391, JSON.stringify(caja));
  await cel.close();
} catch (err) {
  failures++;
  console.log(`  FAIL excepción — ${err?.stack ?? err}`);
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nTodo en verde." : `\n${failures} check(s) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
