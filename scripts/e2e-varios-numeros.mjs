/**
 * Self-test E2E — VARIOS números oficiales de WhatsApp en una sola bandeja
 * (migración 0080). Contra la app real con los mocks:
 *
 *  1. Conectar dos números (cada uno con su nombre) → los dos aparecen en
 *     Ajustes; el principal es el primero; PUT del mismo número lo reconecta
 *     (no lo duplica).
 *  2. Dos clientes escriben, uno por cada número → los dos chats están en la
 *     MISMA bandeja y cada uno dice por qué número habla.
 *  3. La respuesta de cada chat SALE POR SU número (se comprueba en el outbox
 *     del wa-mock).
 *  4. Filtro por número (API y pantalla) y la etiqueta con el nombre en la fila
 *     y el encabezado del chat.
 *  5. Si el mismo cliente escribe por el otro número, su (único) chat se pasa
 *     a ese número y la respuesta sale por él.
 *  6. Nombre editable; quitar un número manda sus chats al principal; el
 *     último número no se puede quitar; un número ajeno da 404.
 *
 * Uso: app viva con WA_MOCK_ENABLED=true. Con SHOTS_DIR=<carpeta> guarda capturas.
 *   node --env-file=.env scripts/e2e-varios-numeros.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR ?? null;
const RUN = Date.now().toString().slice(-7);
const ADMIN = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
const PN1 = `PN-VN1-${RUN}`;
const PN2 = `PN-VN2-${RUN}`;
const WABA = `WABA-VN-${RUN}`;
const CLIENTE_A = `5219981${RUN.padStart(6, "0")}`;
const CLIENTE_B = `5219982${RUN.padStart(6, "0")}`;

let failures = 0;
function ok(name, cond, extra = "") {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  extraHTTPHeaders: { "x-forwarded-for": `10.97.${Number(RUN.slice(-3)) % 256}.1`, origin: BASE },
});
const call = async (method, path, body) => {
  const res = await ctx.request.fetch(`${BASE}${path}`, { method, data: body, failOnStatusCode: false, timeout: 180000 });
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
const inbound = (phoneNumberId, from, text) =>
  call("POST", "/api/dev/wa-mock/inbound", { phoneNumberId, from, name: `Cliente ${from.slice(-4)}`, text });
const convOf = async (phone) =>
  ((await call("GET", "/api/conversations")).json?.conversations ?? []).find((c) => c.contact.phone?.endsWith(phone.slice(-10)));

let previos = [];
try {
  console.log("== Setup ==");
  let login = await call("POST", "/api/auth/sign-up/email", ADMIN);
  if (login.status >= 400) login = await call("POST", "/api/auth/sign-in/email", ADMIN);
  ok("el operador entra", login.status < 400, String(login.status));

  // La organización de pruebas se comparte con otros guiones: se guardan los
  // números que ya tenía para devolverlos al final y empezar con solo los míos.
  previos = ((await call("GET", "/api/settings/whatsapp")).json?.numbers ?? []).map((n) => ({ wabaId: n.wabaId, phoneNumberId: n.phoneNumberId, label: n.label }));

  console.log("== 1. Dos números oficiales ==");
  const c1 = await call("PUT", "/api/settings/whatsapp", { wabaId: WABA, phoneNumberId: PN1, token: "tok-e2e", label: "Ventas Cancún" });
  const c2 = await call("PUT", "/api/settings/whatsapp", { wabaId: WABA, phoneNumberId: PN2, token: "tok-e2e", label: "Ventas Mérida" });
  ok("número 1 conectado", c1.status < 400, JSON.stringify(c1.json));
  ok("número 2 conectado (se AGREGA, no reemplaza)", c2.status < 400, JSON.stringify(c2.json));
  for (const p of previos) await call("DELETE", `/api/settings/whatsapp/numbers/${encodeURIComponent(p.phoneNumberId)}`);
  const again = await call("PUT", "/api/settings/whatsapp", { wabaId: WABA, phoneNumberId: PN2, token: "tok-e2e-2" });
  ok("volver a guardar el mismo número lo reconecta", again.status < 400);
  const settings = await call("GET", "/api/settings/whatsapp");
  const numbers = settings.json?.numbers ?? [];
  ok("Ajustes lista los dos números", numbers.length === 2, JSON.stringify(numbers.map((n) => n.phoneNumberId)));
  ok("el principal es el primero", numbers[0]?.phoneNumberId === PN1 && numbers[0]?.isPrimary === true);
  ok("cada número trae su nombre", numbers[0]?.label === "Ventas Cancún" && numbers[1]?.label === "Ventas Mérida");
  ok("el token solo viaja como sus últimos 4", numbers.every((n) => !("token" in n) && n.tokenLast4?.length === 4));
  const lista = (await call("GET", "/api/whatsapp-numbers")).json?.numbers ?? [];
  ok("/api/whatsapp-numbers (para la Bandeja) no trae secretos", lista.length === 2 && lista.every((n) => !("token" in n) && !("wabaId" in n)));

  console.log("== 2. Una sola bandeja ==");
  await call("DELETE", "/api/dev/wa-mock/outbox");
  ok("entra un cliente por el número 1", (await inbound(PN1, CLIENTE_A, "Hola desde Cancún")).status === 200);
  ok("entra otro por el número 2", (await inbound(PN2, CLIENTE_B, "Hola desde Mérida")).status === 200);
  const hayLosDos = await hasta(async () => (await convOf(CLIENTE_A)) && (await convOf(CLIENTE_B)));
  ok("los dos chats están en la MISMA bandeja", hayLosDos);
  const cA = await convOf(CLIENTE_A);
  const cB = await convOf(CLIENTE_B);
  ok("cada chat dice por qué número habla", cA?.waNumberId === PN1 && cB?.waNumberId === PN2, `${cA?.waNumberId} / ${cB?.waNumberId}`);

  console.log("== 3. Responder sale por el número del chat ==");
  const rA = await call("POST", `/api/conversations/${cA.id}/messages`, { text: "Te atiende Cancún" });
  const rB = await call("POST", `/api/conversations/${cB.id}/messages`, { text: "Te atiende Mérida" });
  ok("las dos respuestas se envían", rA.status < 400 && rB.status < 400, `${rA.status}/${rB.status}`);
  const ob = await outbox();
  const outA = ob.find((o) => o.body?.text?.body === "Te atiende Cancún");
  const outB = ob.find((o) => o.body?.text?.body === "Te atiende Mérida");
  ok("la de Cancún salió por el número 1", outA?.phoneNumberId === PN1, outA?.phoneNumberId);
  ok("la de Mérida salió por el número 2", outB?.phoneNumberId === PN2, outB?.phoneNumberId);

  console.log("== 4. Filtro y etiqueta ==");
  const soloB = (await call("GET", `/api/conversations?limit=50&number=${encodeURIComponent(PN2)}`)).json?.conversations ?? [];
  ok("el filtro por número deja solo los de ese número", soloB.length >= 1 && soloB.every((c) => c.waNumberId === PN2) && soloB.some((c) => c.id === cB.id), String(soloB.length));
  const counts = (await call("GET", `/api/conversations/counts?number=${encodeURIComponent(PN1)}`)).json;
  const lista1 = (await call("GET", `/api/conversations?limit=500&number=${encodeURIComponent(PN1)}`)).json?.conversations ?? [];
  ok("los contadores respetan el filtro (igual que la lista)", counts?.all === lista1.length && lista1.length >= 1, `${counts?.all} vs ${lista1.length}`);

  const page = await ctx.newPage();
  await page.goto(`${BASE}/inbox`, { timeout: 180000 });
  const chipsA = page.locator("[data-number-chip]", { hasText: "Ventas Cancún" });
  const chipsB = page.locator("[data-number-chip]", { hasText: "Ventas Mérida" });
  ok("la fila de Cancún lleva su etiqueta", await chipsA.first().waitFor({ timeout: 90000 }).then(() => true, () => false));
  ok("la fila de Mérida lleva su etiqueta", await chipsB.first().isVisible().catch(() => false));
  await shot(page, "bandeja-dos-numeros");
  await page.getByRole("button", { name: /Filtrar la bandeja/ }).click();
  const selectorNumero = page.getByLabel("Filtrar por número de WhatsApp");
  ok("el menú de filtros trae «Número»", await selectorNumero.isVisible().catch(() => false));
  await shot(page, "bandeja-filtro-numero");
  await selectorNumero.selectOption(PN2);
  const soloMerida = await hasta(async () => (await chipsA.count()) === 0 && (await chipsB.count()) >= 1);
  ok("al filtrar por Mérida solo se ve Mérida", soloMerida);
  await shot(page, "bandeja-filtrada-merida");
  await page.keyboard.press("Escape");
  await page.locator("[data-row-name]", { hasText: "Cliente" }).first().click();
  const enc = page.locator("[data-pm=chat-head] [data-number-chip]");
  ok("el encabezado del chat dice el número", await enc.first().waitFor({ timeout: 30000 }).then(() => true, () => false));
  await shot(page, "chat-con-numero");

  console.log("== 5. El mismo cliente por el otro número ==");
  await inbound(PN2, CLIENTE_A, "Ahora te escribo a Mérida");
  const pasoAlOtro = await hasta(async () => (await convOf(CLIENTE_A))?.waNumberId === PN2);
  ok("su (único) chat pasa al número por el que escribió", pasoAlOtro);
  const todos = (await call("GET", "/api/conversations")).json?.conversations ?? [];
  ok("sigue habiendo un solo chat por cliente", todos.filter((c) => c.contact.phone?.endsWith(CLIENTE_A.slice(-10))).length === 1);
  await call("DELETE", "/api/dev/wa-mock/outbox");
  const cA2 = await convOf(CLIENTE_A);
  await call("POST", `/api/conversations/${cA2.id}/messages`, { text: "Respuesta por Mérida" });
  const o2 = (await outbox()).find((o) => o.body?.text?.body === "Respuesta por Mérida");
  ok("y la respuesta sale por el número 2", o2?.phoneNumberId === PN2, o2?.phoneNumberId);

  console.log("== 6. Nombre, quitar y casos infelices ==");
  const col = await call("PATCH", `/api/settings/whatsapp/numbers/${PN2}`, { color: "morado" });
  ok("elegir el color de un número", col.status === 200);
  ok("un color fuera de la paleta se rechaza", (await call("PATCH", `/api/settings/whatsapp/numbers/${PN2}`, { color: "fucsia" })).status === 422);
  const conColor = (await call("GET", "/api/whatsapp-numbers")).json?.numbers ?? [];
  ok("cada número trae su color (el elegido, o uno automático distinto)", conColor.find((n) => n.id === PN2)?.color === "morado" && conColor.find((n) => n.id === PN1)?.color && conColor.find((n) => n.id === PN1)?.color !== "morado", JSON.stringify(conColor.map((n) => n.color)));
  const ren = await call("PATCH", `/api/settings/whatsapp/numbers/${PN2}`, { label: "Mérida Centro" });
  ok("renombrar un número", ren.status === 200);
  ok("un número ajeno da 404", (await call("PATCH", "/api/settings/whatsapp/numbers/PN-NO-ES-MIO", { label: "x" })).status === 404);
  ok("un nombre demasiado largo se rechaza", (await call("PATCH", `/api/settings/whatsapp/numbers/${PN2}`, { label: "x".repeat(60) })).status === 422);
  await page.goto(`${BASE}/settings/whatsapp`, { timeout: 180000 });
  const campos = page.locator("[data-testid=numero-nombre]");
  ok("Ajustes muestra una tarjeta por número", await campos.first().waitFor({ timeout: 90000 }).then(() => true, () => false) && (await campos.count()) === 2);
  await shot(page, "ajustes-dos-numeros");
  const quitar = await call("DELETE", `/api/settings/whatsapp/numbers/${PN2}`);
  ok("quitar el número 2", quitar.status === 200, JSON.stringify(quitar.json));
  const trasQuitar = await convOf(CLIENTE_B);
  ok("sus chats pasan al principal", trasQuitar?.waNumberId === PN1, trasQuitar?.waNumberId);
  const ultimo = await call("DELETE", `/api/settings/whatsapp/numbers/${PN1}`);
  ok("el último número NO se puede quitar (409)", ultimo.status === 409, String(ultimo.status));
  await call("DELETE", "/api/dev/wa-mock/outbox");
  await call("POST", `/api/conversations/${trasQuitar.id}/messages`, { text: "Ya por el principal" });
  const o3 = (await outbox()).find((o) => o.body?.text?.body === "Ya por el principal");
  ok("y se les contesta por el principal", o3?.phoneNumberId === PN1, o3?.phoneNumberId);
} finally {
  // Se devuelve la organización como estaba para los demás guiones.
  for (const p of previos) {
    await call("PUT", "/api/settings/whatsapp", { wabaId: p.wabaId, phoneNumberId: p.phoneNumberId, token: "tok-e2e", ...(p.label ? { label: p.label } : {}) });
  }
  for (const pn of [PN1, PN2]) await call("DELETE", `/api/settings/whatsapp/numbers/${pn}`);
  await browser.close();
}
console.log(failures === 0 ? "\nTODO OK" : `\n${failures} FALLO(S)`);
process.exit(failures === 0 ? 1 - 1 : 1);
