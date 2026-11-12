/**
 * Self-test E2E de la spec 048 — Vender desde Plataforma. Contra la app real
 * con mocks:
 *
 *  1. El administrador crea una empresa con el plan Esencial; su Propietaria
 *     activa la cuenta. La lista muestra su semáforo («Salud»).
 *  2. Prueba gratis: a 2 días → aviso «tu prueba termina» en la franja de la
 *     Propietaria (con enlace de WhatsApp si hay contacto).
 *  3. Prueba vencida → la IA en pausa (la varita responde 429 sin llamar al
 *     modelo), el aviso no se puede cerrar, y la Bandeja sigue abierta.
 *  4. Registrar un pago del plan → «Pagado», la IA vuelve.
 *  5. Persona extra → el tope de personas sube 1 (si la empresa tiene tope).
 *  6. Interruptor de emergencia «IA» → frenada en todas; al encenderla vuelve.
 *  7. Aviso a todos → franja en la empresa, se cierra, se termina.
 *  8. Cambiar de plan con vista previa (Esencial → Pro: se enciende el
 *     Laboratorio; Cancelar no cambia nada; Aplicar sí). Marcas de funciones.
 *  9. Planes editables: los módulos de un plan se guardan y vuelven a fábrica.
 * 10. Una persona común → 404 en /api/platform/controls y /billing.
 *
 * Capturas opcionales: E2E_CAPTURAS=<carpeta> guarda las pantallas (2x).
 *
 * Uso: app viva con los mocks y PLATFORM_ORG_ID = la organización de
 * e2e@vocero.test (después de e2e-multiorg / e2e-plataforma).
 *   node --env-file=.env scripts/e2e-plataforma-vender.mjs
 * Re-ejecutable. Sale con 1 si algo falla.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const ADMIN = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
const OWNER = { email: `duena.v.${RUN}@vender.test`, name: `Dueña V ${RUN}` };
const PASS = "contraseña-de-la-duena-v";
const NAME = `Negocio V ${RUN}`;
const CAPTURAS = process.env.E2E_CAPTURAS || "";
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });

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
    await sleep(400);
  }
}
const visible = (loc, ms = 15000) => loc.first().waitFor({ timeout: ms }).then(() => true, () => false);

const sql = postgres(process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL, { max: 2, onnotice: () => {} });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});

let ips = 0;
async function persona() {
  ips++;
  const ctx = await browser.newContext({
    deviceScaleFactor: CAPTURAS ? 2 : 1,
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { "x-forwarded-for": `10.77.${Number(RUN.slice(-3)) % 256}.${ips}`, origin: BASE },
  });
  const call = async (method, path, body) => {
    const res = await ctx.request.fetch(`${BASE}${path}`, { method, data: body, failOnStatusCode: false, maxRedirects: 0, timeout: 120_000 });
    let json = null;
    try {
      json = await res.json();
    } catch {
      // no es JSON
    }
    return { status: res.status(), json };
  };
  const entrar = (email, password) => call("POST", "/api/auth/sign-in/email", { email, password });
  return { ctx, call, entrar };
}

async function captura(page, nombre, locator) {
  if (!CAPTURAS) return;
  try {
    if (locator) await locator.first().screenshot({ path: `${CAPTURAS}/${nombre}.png` });
    else await page.screenshot({ path: `${CAPTURAS}/${nombre}.png` });
  } catch (err) {
    console.log(`  (sin captura ${nombre}: ${err.message})`);
  }
}

const varita = (P) => P.call("POST", "/api/writing-assist", { action: "improve", text: "hola quiero informes" });

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
  // Re-ejecutable: sin interruptores ni avisos de una corrida anterior.
  await sql`delete from platform_kill_switch`;
  await sql`update platform_broadcast set ended_at = now() where ended_at is null`;
  await sql`update platform_plan_catalog set modules = null`;

  console.log("\n== 1 · Alta con plan Esencial y semáforo ==");
  const alta = await A.call("POST", "/api/platform/organizations", { name: NAME, ownerName: OWNER.name, ownerEmail: OWNER.email, profile: "esencial" });
  ok("se crea la empresa", alta.status === 201 && alta.json?.activationUrl, JSON.stringify(alta.json));
  const orgId = alta.json?.organizationId;
  const B = await persona();
  const pAct = await B.ctx.newPage();
  await pAct.goto(alta.json.activationUrl);
  await pAct.fill("#new-password", PASS);
  await pAct.fill("#confirm-password", PASS);
  await pAct.getByRole("button", { name: "Guardar contraseña" }).click();
  ok("la Propietaria activa su cuenta", await visible(pAct.getByTestId("set-password-done")));
  await pAct.close();
  ok("la Propietaria entra", (await B.entrar(OWNER.email, PASS)).status < 400);

  const lista = await A.call("GET", "/api/platform/organizations");
  const fila = lista.json?.organizations?.find((o) => o.id === orgId);
  ok("la lista trae su salud y su cobro", fila?.health?.level && fila?.billing?.kind === "none", JSON.stringify(fila?.health));
  ok("una empresa recién creada sin WhatsApp no está en rojo todavía", fila?.health?.level !== "red", JSON.stringify(fila?.health));
  const p = await A.ctx.newPage();
  await p.goto(`${BASE}/platform/organizaciones`);
  ok("la columna «Salud» se ve en la lista", await visible(p.getByTestId(`platform-org-${orgId}`).getByTestId("platform-org-health")));
  await p.getByTestId("platform-filter-health").click();
  await captura(p, "01-lista-salud");
  await p.getByTestId("platform-filter-health").click();

  console.log("\n== 2 · Prueba gratis que está por terminar ==");
  const trial = await A.call("PUT", `/api/platform/organizations/${orgId}/billing`, { trialDays: 2 });
  ok("prueba de 2 días → «trial_ending»", trial.json?.billing?.state?.kind === "trial_ending", JSON.stringify(trial.json?.billing?.state));
  const avisos1 = await B.call("GET", "/api/notices");
  ok("la Propietaria recibe el aviso (sin montos)", avisos1.json?.billing?.kind === "trial_ending" && !/\$|MXN/.test(avisos1.json?.billing?.text ?? ""), JSON.stringify(avisos1.json));
  ok("…y su IA sigue", (await varita(B)).status !== 429);
  const pB = await B.ctx.newPage();
  await pB.goto(`${BASE}/inbox`);
  ok("la franja del aviso se ve en la Bandeja", await visible(pB.getByTestId("billing-notice-banner")));
  await captura(pB, "02-aviso-prueba-por-terminar", pB.getByTestId("billing-notice-banner"));
  await pB.getByTestId("billing-notice-close").click();
  ok("se puede cerrar por hoy", await hasta(async () => (await pB.getByTestId("billing-notice-banner").count()) === 0, 5000));

  await p.goto(`${BASE}/platform/organizaciones/${orgId}/cobro`);
  ok("la pestaña «Cobro y prueba» muestra el estado", await visible(p.getByTestId("platform-billing-kind")));
  ok("…«por terminar»", (await p.getByTestId("platform-billing-kind").getAttribute("data-kind")) === "trial_ending");
  await captura(p, "03-cobro-y-prueba");

  console.log("\n== 3 · Prueba vencida: IA en pausa, Bandeja abierta ==");
  const ayer = new Date(Date.now() - 86_400_000).toISOString();
  const vencida = await A.call("PUT", `/api/platform/organizations/${orgId}/billing`, { trialEndsAt: ayer });
  ok("prueba vencida → restringida", vencida.json?.billing?.state?.kind === "trial_expired" && vencida.json?.billing?.state?.restricted === true, JSON.stringify(vencida.json?.billing?.state));
  const usoAntes = (await sql`select count(*)::int as n from ai_usage where organization_id = ${orgId}`)[0].n;
  const bloqueada = await varita(B);
  ok("la varita de redacción → 429 (IA en pausa)", bloqueada.status === 429, `${bloqueada.status} ${JSON.stringify(bloqueada.json)}`);
  ok("…sin gastar IA", (await sql`select count(*)::int as n from ai_usage where organization_id = ${orgId}`)[0].n === usoAntes);
  ok("la Bandeja sigue respondiendo", (await B.call("GET", "/api/conversations")).status === 200);
  await pB.goto(`${BASE}/inbox`);
  ok("el aviso de prueba terminada se ve", await visible(pB.getByTestId("billing-notice-banner")));
  ok("…y no se puede cerrar", (await pB.getByTestId("billing-notice-close").count()) === 0);
  await captura(pB, "04-aviso-prueba-terminada", pB.getByTestId("billing-notice-banner"));

  console.log("\n== 4 · Registrar el pago del plan ==");
  const pago = await A.call("POST", `/api/platform/organizations/${orgId}/billing/payments`, { kind: "plan", amountMxn: 999, months: 1, note: "transferencia e2e" });
  ok("pago registrado → «Pagado»", pago.status === 201 && pago.json?.billing?.state?.kind === "paid", `${pago.status} ${JSON.stringify(pago.json?.billing?.state)}`);
  ok("…queda en la bitácora de pagos", pago.json?.billing?.payments?.length === 1);
  ok("la IA vuelve", (await varita(B)).status !== 429);
  ok("la bitácora de auditoría tiene el pago", (await sql`select 1 from platform_audit_log where action = 'billing.payment_recorded' and target_org_id = ${orgId} limit 1`).length === 1);

  console.log("\n== 5 · Persona extra ==");
  const antes = (await A.call("GET", `/api/platform/organizations/${orgId}/summary`)).json?.limits?.members ?? null;
  const extra = await A.call("POST", `/api/platform/organizations/${orgId}/billing/payments`, { kind: "extra_person", amountMxn: 149, quantity: 1 });
  if (antes === null) ok("sin tope de personas, el extra se rechaza con un motivo claro (422)", extra.status === 422, `${extra.status}`);
  else {
    const despues = (await A.call("GET", `/api/platform/organizations/${orgId}/summary`)).json?.limits?.members;
    ok("el tope de personas sube 1", extra.status === 201 && despues === antes + 1, `${antes} → ${despues} (${extra.status})`);
  }

  console.log("\n== 6 · Interruptor de emergencia «IA» ==");
  await p.goto(`${BASE}/platform/controles`);
  ok("la pestaña «Controles» abre", await visible(p.getByTestId("platform-kill-switches")));
  await captura(p, "05-controles");
  const off = await A.call("PUT", "/api/platform/controls", { killSwitch: { key: "ai", active: true, reason: "prueba e2e" } });
  ok("se apaga la IA de todas", off.status === 200, String(off.status));
  ok("la empresa ya no puede usar IA", await hasta(async () => (await varita(B)).status === 429, 15000));
  const on = await A.call("PUT", "/api/platform/controls", { killSwitch: { key: "ai", active: false } });
  ok("se vuelve a encender", on.status === 200);
  ok("…y la IA vuelve", await hasta(async () => (await varita(B)).status !== 429, 15000));

  console.log("\n== 7 · Aviso a todos los clientes ==");
  const msg = `Mantenimiento programado ${RUN}`;
  const bc = await A.call("PUT", "/api/platform/controls", { broadcast: { message: msg, level: "warning" } });
  ok("se publica el aviso", bc.status === 200, String(bc.status));
  await pB.goto(`${BASE}/inbox`);
  ok("la empresa lo ve arriba", await visible(pB.getByTestId("platform-broadcast-banner").filter({ hasText: msg })));
  await captura(pB, "06-aviso-a-todos", pB.getByTestId("platform-broadcast-banner"));
  await pB.getByTestId("platform-broadcast-close").click();
  await pB.reload();
  await sleep(1500);
  ok("cerrado, no vuelve a salir", (await pB.getByTestId("platform-broadcast-banner").count()) === 0);
  await p.reload();
  await visible(p.getByTestId("platform-broadcast-current"));
  await captura(p, "07-controles-con-aviso");
  const fin = await A.call("PUT", "/api/platform/controls", { endBroadcast: true });
  ok("se termina el aviso", fin.status === 200 && (await B.call("GET", "/api/notices")).json?.broadcast === null);

  console.log("\n== 8 · Cambiar de plan con vista previa ==");
  await p.goto(`${BASE}/platform/organizaciones/${orgId}`);
  ok("la ficha dice Plan Esencial", await hasta(async () => (await p.getByTestId("platform-modules-plan").innerText().catch(() => "")).includes("Esencial")));
  ok("el Laboratorio aparece «no incluido en su plan»", (await p.getByTestId("platform-module-lab").getAttribute("data-mark")) === "not_included");
  ok("…y el Agente «incluido»", (await p.getByTestId("platform-module-agent").getAttribute("data-mark")) === "included");
  await captura(p, "08-funciones-por-plan", p.getByTestId("platform-plan-templates"));
  await p.getByTestId("platform-template-pro").click();
  ok("la vista previa se abre", await visible(p.getByTestId("platform-plan-preview")));
  ok("…dice que se enciende el Laboratorio", (await p.getByTestId("platform-plan-preview-on").innerText().catch(() => "")).includes("Laboratorio"));
  ok("…y que ningún dato se borra", (await p.getByTestId("platform-plan-preview").innerText()).includes("Ningún dato se borra"));
  await captura(p, "09-vista-previa-cambio-de-plan", p.getByTestId("platform-plan-preview"));
  await p.getByTestId("platform-plan-preview-cancel").click();
  ok("Cancelar no cambia nada", (await sql`select lab from organization_module where organization_id = ${orgId}`)[0]?.lab === false);
  await p.getByTestId("platform-template-pro").click();
  await p.getByTestId("platform-plan-preview-apply").click();
  ok("Aplicar enciende el Laboratorio", await hasta(async () => (await sql`select lab from organization_module where organization_id = ${orgId}`)[0]?.lab === true));
  ok("…y la ficha dice Plan Pro", await hasta(async () => (await p.getByTestId("platform-modules-plan").innerText().catch(() => "")).includes("Pro")));
  await captura(p, "10-funciones-plan-pro");

  console.log("\n== 9 · Qué trae cada plan, editable ==");
  const plans = await A.call("GET", "/api/platform/plans");
  ok("la API de planes trae los módulos de cada plan", plans.json?.modules?.esencial && plans.json?.modulesDefaults?.esencial);
  const conAgenda = { ...plans.json.modulesDefaults.esencial, agenda: !plans.json.modulesDefaults.esencial.agenda };
  const guarda = await A.call("PUT", "/api/platform/plans", { scope: "esencial", modules: conAgenda });
  ok("se guardan los módulos del plan Esencial", guarda.status === 200 && (await A.call("GET", "/api/platform/plans")).json?.modulesCustom?.includes("esencial"), String(guarda.status));
  await p.goto(`${BASE}/platform/organizaciones?tab=plans`);
  await p.getByTestId("platform-subtab-plans").click().catch(() => {});
  ok("el editor de planes muestra los módulos", await visible(p.getByTestId("platform-plan-esencial-modules")));
  await captura(p, "11-editor-modulos-plan", p.getByTestId("platform-plan-esencial"));
  const reset = await A.call("PUT", "/api/platform/plans", { scope: "esencial", modules: null });
  ok("«Volver a los de fábrica»", reset.status === 200 && !(await A.call("GET", "/api/platform/plans")).json?.modulesCustom?.includes("esencial"));

  console.log("\n== 10 · Solo el administrador ==");
  ok("una Propietaria común → 404 en controles", (await B.call("GET", "/api/platform/controls")).status === 404);
  ok("…y en el cobro", (await B.call("GET", `/api/platform/organizations/${orgId}/billing`)).status === 404);
  ok("…y no puede registrar pagos", (await B.call("POST", `/api/platform/organizations/${orgId}/billing/payments`, { kind: "plan", amountMxn: 1, months: 1 })).status === 404);

  await pB.close();
  await p.close();
}

try {
  await main();
} catch (err) {
  failures++;
  fallas.push(`excepción: ${err?.message ?? err}`);
  console.error(err);
} finally {
  await sql`delete from platform_kill_switch`.catch(() => {});
  await sql`update platform_broadcast set ended_at = now() where ended_at is null`.catch(() => {});
  await browser.close();
  await sql.end();
}
console.log(`\n${checks - failures}/${checks} comprobaciones OK`);
if (failures) {
  console.log(`Fallaron: ${fallas.join(" · ")}`);
  process.exit(1);
}
