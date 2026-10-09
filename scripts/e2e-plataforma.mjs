/**
 * Self-test E2E de la Fase 3, PR 2 — administrador de plataforma y alta de
 * organizaciones (tests/e2e/us-plataforma.md). Contra la app real con mocks:
 *
 *  1. Antes de ser administrador, /platform y /api/platform/* → 404.
 *  2. El operador da el rol con scripts/platform-admin.mjs (primero sin
 *     --apply: no escribe; luego con --apply).
 *  3. Desde /platform (navegador) se crea la organización B; su Propietaria
 *     activa la cuenta con el enlace de un solo uso.
 *  4. Aislamiento: B no ve nada de A ni A de B; B (usuaria común) → 404 en
 *     /platform.
 *  5. Suspensión: B queda fuera (sesión abierta y login), su webhook no entra
 *     (webhook_unrouted, org_suspended); al reactivar vuelve.
 *  6. Restablecimiento: contraseña de administrador incorrecta → sin enlace;
 *     correcta → enlace; la persona pone la suya; aviso en Avisos; 3 fallos
 *     → bloqueo.
 *  7. Borrado suave (30 días) y restauración.
 *  8. Cabeceras de seguridad.
 *
 * Uso: app viva con WA_MOCK_ENABLED=true y los mocks, PLATFORM_ORG_ID = la
 * organización de e2e@vocero.test (corre antes pnpm test:e2e).
 *   node --env-file=.env scripts/e2e-plataforma.mjs
 * Re-ejecutable (cada corrida crea su propia organización B). Sale con 1 si
 * algo falla.
 */
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const ADMIN = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
const OWNER_B = { email: `duena.b.${RUN}@plataforma.test`, name: `Dueña B ${RUN}` };
const PASS_B = "contraseña-de-la-duena-b";
const PASS_B2 = "contraseña-nueva-de-b-22";
const NAME_B = `Negocio B ${RUN}`;
const PN_A = "PN-E2E-PLAT-A";
const PN_B = `PN-E2E-PLAT-B-${RUN}`;

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

const sql = postgres(process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL, { max: 2, onnotice: () => {} });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});

let ips = 0;
/** Una persona: su propio navegador (cookies) y su propia IP (límite de login). */
async function persona() {
  ips++;
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.88.${Number(RUN.slice(-3)) % 256}.${ips}`, origin: BASE } });
  const call = async (method, path, body) => {
    const res = await ctx.request.fetch(`${BASE}${path}`, { method, data: body, failOnStatusCode: false, maxRedirects: 0 });
    let json = null;
    try {
      json = await res.json();
    } catch {
      // no es JSON
    }
    return { status: res.status(), json, headers: res.headers() };
  };
  const entrar = async (email, password) => (await call("POST", "/api/auth/sign-in/email", { email, password }));
  return { ctx, call, entrar };
}

/** Corre un script de operador y devuelve su salida y su código (sin lanzar). */
function runOps(script, args) {
  try {
    const out = execFileSync("node", [`scripts/${script}`, ...args], { env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function opsScript(args) {
  return execFileSync("node", ["scripts/platform-admin.mjs", ...args], { env: process.env, encoding: "utf8" });
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
  ok("PLATFORM_ORG_ID es la organización del operador (corre con PLATFORM)", process.env.PLATFORM_ORG_ID === orgA, `${process.env.PLATFORM_ORG_ID} vs ${orgA}`);
  await A.call("PUT", "/api/settings/whatsapp", { wabaId: "WABA-E2E-PLAT-A", phoneNumberId: PN_A, token: "tok-plat-a" });
  // Re-ejecutable: sin rol ni bloqueo de una corrida anterior.
  await sql`delete from platform_admin where user_id = (select id from "user" where email = ${ADMIN.email})`;

  console.log("\n== 1 · Sin el rol, /platform no existe ==");
  ok("GET /api/platform/organizations → 404", (await A.call("GET", "/api/platform/organizations")).status === 404);
  const page0 = await A.ctx.newPage();
  const r0 = await page0.goto(`${BASE}/platform`);
  ok("la página /platform → 404", r0?.status() === 404, String(r0?.status()));
  await page0.close();

  console.log("\n== 2 · El operador da el rol con el script ==");
  const seco = opsScript(["add", "--email", ADMIN.email]);
  ok("sin --apply muestra los pasos y no escribe", /No se escribió nada/.test(seco) && /Es miembro de la organización de la plataforma/.test(seco), seco);
  ok("…y de verdad no escribió", (await sql`select 1 from platform_admin p join "user" u on u.id = p.user_id where u.email = ${ADMIN.email}`).length === 0);
  const aplicado = opsScript(["add", "--email", ADMIN.email, "--apply"]);
  ok("con --apply lo da de alta", /ya es administrador de plataforma/.test(aplicado), aplicado);
  let noMiembro = "";
  try {
    opsScript(["add", "--email", "nadie-que-exista@plataforma.test", "--apply"]);
  } catch (err) {
    noMiembro = String(err.stderr ?? err);
  }
  ok("una cuenta que no existe → error y nada escrito", /no hay ninguna cuenta/.test(noMiembro));

  console.log("\n== 3 · Alta de la organización B desde /platform ==");
  const page = await A.ctx.newPage();
  const r1 = await page.goto(`${BASE}/platform`);
  ok("ahora /platform → 200", r1?.status() === 200, String(r1?.status()));
  ok("el menú muestra «Plataforma»", (await page.getByRole("link", { name: "Plataforma" }).count()) > 0);
  // 036 (PR 4): dos pestañas; «Mi panel» trae la bitácora.
  const pestanas = page.getByRole("navigation", { name: "Secciones de Plataforma" });
  ok("pestañas «Mi panel» y «Organizaciones»", (await pestanas.getByRole("link", { name: "Mi panel" }).count()) === 1 && (await pestanas.getByRole("link", { name: "Organizaciones" }).count()) === 1);
  ok("«Mi panel» muestra la bitácora", await page.getByTestId("platform-audit").waitFor({ timeout: 20000 }).then(() => true, () => false));
  await pestanas.getByRole("link", { name: "Organizaciones" }).click();
  await page.waitForURL(/\/platform\/organizaciones$/);
  await page.getByTestId("platform-create-open").click();
  await page.fill("#org-name", NAME_B);
  await page.fill("#owner-name", OWNER_B.name);
  await page.fill("#owner-email", OWNER_B.email);
  await page.getByTestId("platform-create-org").click();
  await page.getByTestId("platform-link-url").waitFor({ timeout: 20000 });
  const activacion = (await page.getByTestId("platform-link-url").innerText()).trim();
  ok("se muestra el enlace de activación (una vez)", /\/activar\/[A-Za-z0-9_-]{40,}$/.test(activacion), activacion);
  const [orgB] = await sql`select id, status from organization where name = ${NAME_B}`;
  ok("la organización B existe y está activa", orgB?.status === "active");
  ok("el enlace NO está guardado en la BD", (await sql`select 1 from account_link_token where token_hash = ${activacion.split("/").pop()}`).length === 0);
  const repetido = await A.call("POST", "/api/platform/organizations", { name: "Otra", ownerName: "X", ownerEmail: OWNER_B.email });
  ok("el mismo correo otra vez → 409", repetido.status === 409, JSON.stringify(repetido.json));

  const B = await persona();
  const sinActivar = await B.entrar(OWNER_B.email, PASS_B);
  ok("antes de activar, la Propietaria B no puede entrar", sinActivar.status >= 400);
  const pAct = await B.ctx.newPage();
  await pAct.goto(activacion);
  await pAct.fill("#new-password", PASS_B);
  await pAct.fill("#confirm-password", PASS_B);
  await pAct.getByRole("button", { name: "Guardar contraseña" }).click();
  ok("activa su cuenta con el enlace", await pAct.getByTestId("set-password-done").waitFor({ timeout: 15000 }).then(() => true, () => false));
  await pAct.goto(activacion);
  ok("el enlace ya no sirve una segunda vez", await pAct.getByTestId("set-password-invalid").waitFor({ timeout: 15000 }).then(() => true, () => false));
  await pAct.close();
  ok("la Propietaria B entra con su contraseña", (await B.entrar(OWNER_B.email, PASS_B)).status < 400);

  console.log("\n== 4 · Aislamiento entre A y B ==");
  ok("B conecta su WhatsApp", (await B.call("PUT", "/api/settings/whatsapp", { wabaId: `WABA-E2E-PLAT-B-${RUN}`, phoneNumberId: PN_B, token: "tok-plat-b" })).status === 200);
  const secretoB = `SECRETO-B-PLAT-${RUN}`;
  await A.call("POST", "/api/dev/wa-mock/inbound", { phoneNumberId: PN_B, from: "5215577001100", name: "Cliente de B", text: secretoB, waMessageId: `wamid.plat.b.${RUN}` });
  const secretoA = `SECRETO-A-PLAT-${RUN}`;
  await A.call("POST", "/api/dev/wa-mock/inbound", { phoneNumberId: PN_A, from: "5215577001101", name: "Cliente de A", text: secretoA, waMessageId: `wamid.plat.a.${RUN}` });
  const convB = await hasta(async () => (((await B.call("GET", "/api/conversations")).json?.conversations ?? []).some((c) => c.contact?.name === "Cliente de B")));
  ok("B ve su conversación", convB);
  const deA = JSON.stringify((await A.call("GET", "/api/conversations")).json);
  const deB = JSON.stringify((await B.call("GET", "/api/conversations")).json);
  ok("A no ve nada de B", !deA.includes("Cliente de B") && !deA.includes(secretoB));
  ok("B no ve nada de A", !deB.includes("Cliente de A") && !deB.includes(secretoA));
  ok("B (usuaria común) → 404 en /api/platform/organizations", (await B.call("GET", "/api/platform/organizations")).status === 404);
  const pB = await B.ctx.newPage();
  ok("B → 404 en la página /platform", (await pB.goto(`${BASE}/platform`))?.status() === 404);
  ok("B no ve «Plataforma» en su menú", (await pB.goto(`${BASE}/inbox`), (await pB.getByRole("link", { name: "Plataforma" }).count()) === 0));
  await pB.close();
  const listaA = (await A.call("GET", "/api/platform/organizations")).json?.organizations ?? [];
  ok("el administrador ve B en la lista, sin contenido", listaA.some((o) => o.id === orgB.id) && !JSON.stringify(listaA).includes(secretoB));

  await consumoEnPlataforma(A, B, orgB.id);
  await topesYAvisos(A, B, orgB.id);
  await costosEnPlataforma(A, B, orgB.id);

  console.log("\n== 5 · Suspensión ==");
  const sus = await A.call("POST", `/api/platform/organizations/${orgB.id}/status`, { action: "suspend", reason: "prueba e2e" });
  ok("el administrador suspende B", sus.status === 200 && sus.json?.status === "suspended", JSON.stringify(sus.json));
  ok("la sesión abierta de B deja de valer (401)", (await B.call("GET", "/api/conversations")).status === 401);
  const loginSus = await B.entrar(OWNER_B.email, PASS_B);
  ok("B no puede iniciar sesión (organización suspendida)", loginSus.status === 403 && /suspendido/.test(JSON.stringify(loginSus.json)), `${loginSus.status} ${JSON.stringify(loginSus.json)}`);
  const pLogin = await (await persona()).ctx.newPage();
  await pLogin.goto(`${BASE}/login`);
  await pLogin.fill("#email", OWNER_B.email);
  await pLogin.fill("#password", PASS_B);
  await pLogin.getByRole("button", { name: /Iniciar sesión|Entrar/ }).click();
  ok("la pantalla de login lo dice claro", await pLogin.getByText("Tu negocio está suspendido").waitFor({ timeout: 10000 }).then(() => true, () => false));
  await pLogin.close();
  const textoSus = `mientras suspendida ${RUN}`;
  const wh = await A.call("POST", "/api/dev/wa-mock/inbound", { phoneNumberId: PN_B, from: "5215577001102", name: "Cliente tardío", text: textoSus, waMessageId: `wamid.plat.sus.${RUN}` });
  ok("el webhook responde 200 (Meta no reintenta en vano)", wh.status === 200);
  ok(
    "el evento queda en webhook_unrouted con motivo org_suspended",
    await hasta(async () => (await sql`select 1 from webhook_unrouted where route_key = ${PN_B} and reason = 'org_suspended'`).length > 0)
  );
  ok("…y no entró a B", (await sql`select 1 from message where organization_id = ${orgB.id} and text = ${textoSus}`).length === 0);
  ok("A sigue funcionando", (await A.call("GET", "/api/conversations")).status === 200);
  const re = await A.call("POST", `/api/platform/organizations/${orgB.id}/status`, { action: "reactivate" });
  ok("el administrador reactiva B", re.json?.status === "active");
  ok("B vuelve a entrar", (await B.entrar(OWNER_B.email, PASS_B)).status < 400);
  const planta = await A.call("POST", `/api/platform/organizations/${orgA}/status`, { action: "suspend" });
  ok("la organización de la plataforma no se puede suspender", planta.status === 422);

  console.log("\n== 6 · Restablecimiento de contraseña ==");
  const [{ id: userB }] = await sql`select id from "user" where email = ${OWNER_B.email}`;
  const mal = await A.call("POST", `/api/platform/users/${userB}/link`, { password: "no-es-la-mia" });
  ok("con la contraseña de administrador incorrecta → 403 y sin enlace", mal.status === 403 && !mal.json?.url);
  const bien = await A.call("POST", `/api/platform/users/${userB}/link`, { password: ADMIN.password });
  ok("con la correcta → enlace de 2 h", bien.status === 201 && /\/restablecer\//.test(bien.json?.url ?? ""), JSON.stringify(bien.json));
  const deB2 = await B.call("POST", `/api/platform/users/${userB}/link`, { password: PASS_B });
  ok("una usuaria común no puede generar enlaces (404)", deB2.status === 404);
  const C = await persona();
  const pReset = await C.ctx.newPage();
  await pReset.goto(bien.json.url);
  await pReset.fill("#new-password", PASS_B2);
  await pReset.fill("#confirm-password", PASS_B2);
  await pReset.getByRole("button", { name: "Guardar contraseña" }).click();
  ok("B pone su nueva contraseña con el enlace", await pReset.getByTestId("set-password-done").waitFor({ timeout: 15000 }).then(() => true, () => false));
  await pReset.close();
  ok("la sesión vieja de B se cerró", (await B.call("GET", "/api/conversations")).status === 401);
  ok("la contraseña vieja ya no entra", (await B.entrar(OWNER_B.email, PASS_B)).status >= 400);
  ok("la nueva sí", (await B.entrar(OWNER_B.email, PASS_B2)).status < 400);
  ok(
    "el equipo de B ve el aviso en Avisos",
    (await sql`select 1 from team_chat_message where organization_id = ${orgB.id} and author_user_id is null and body like '%se restableció la contraseña%'`).length > 0
  );
  const acciones = (await A.call("GET", `/api/platform/audit?org=${orgB.id}`)).json?.entries?.map((e) => e.action) ?? [];
  ok("la bitácora tiene alta, suspensión, reactivación, enlace y su uso", ["organization.created", "organization.suspended", "organization.reactivated", "link.reset_created", "link.used"].every((a) => acciones.includes(a)), JSON.stringify(acciones));
  for (let i = 0; i < 2; i++) await A.call("POST", `/api/platform/users/${userB}/link`, { password: "mal" });
  const tercero = await A.call("POST", `/api/platform/users/${userB}/link`, { password: "mal" });
  ok("al tercer intento fallido → bloqueo (423)", tercero.status === 423, String(tercero.status));
  const bloqueado = await A.call("POST", `/api/platform/users/${userB}/link`, { password: ADMIN.password });
  ok("bloqueado, ni la contraseña correcta genera enlace", bloqueado.status === 423 && !bloqueado.json?.url);
  await sql`update platform_admin set locked_until = null, failed_reauth = 0 where user_id = (select id from "user" where email = ${ADMIN.email})`;

  console.log("\n== 7 · Borrado suave y restauración ==");
  const del = await A.call("POST", `/api/platform/organizations/${orgB.id}/status`, { action: "delete", reason: "prueba" });
  const dias = del.json?.purgeAfter ? (new Date(del.json.purgeAfter).getTime() - Date.now()) / 86_400_000 : 0;
  ok("borrada, con 30 días de gracia", del.json?.status === "deleted" && dias > 29.9 && dias < 30.1, JSON.stringify(del.json));
  ok("borrada, sus usuarias no entran", (await B.entrar(OWNER_B.email, PASS_B2)).status === 403);
  const purgaTemprana = runOps("purge-organization.mjs", ["--org", orgB.id, "--confirm", NAME_B]);
  ok("purgar dentro de los 30 días se niega", purgaTemprana.code !== 0 && /plazo de gracia/.test(purgaTemprana.out), purgaTemprana.out);
  ok("restaurar la devuelve activa", (await A.call("POST", `/api/platform/organizations/${orgB.id}/status`, { action: "restore" })).json?.status === "active");

  console.log("\n== 7b · Purga definitiva (script del operador) ==");
  const NAME_C = `Desechable ${RUN}`;
  const altaC = await A.call("POST", "/api/platform/organizations", { name: NAME_C, ownerName: "C", ownerEmail: `c.${RUN}@plataforma.test` });
  const orgC = altaC.json?.organizationId;
  await A.call("POST", `/api/platform/organizations/${orgC}/status`, { action: "delete", reason: "purga e2e" });
  await sql`update organization set purge_after = now() - interval '1 minute' where id = ${orgC}`;
  const seca = runOps("purge-organization.mjs", ["--org", orgC]);
  ok("sin --confirm muestra lo que se borraría y no borra", seca.code === 0 && /No se borró nada/.test(seca.out) && /pipeline_stage: 5 fila/.test(seca.out), seca.out);
  const malNombre = runOps("purge-organization.mjs", ["--org", orgC, "--confirm", "otro nombre"]);
  ok("con un nombre que no coincide se niega", malNombre.code !== 0 && (await sql`select 1 from organization where id = ${orgC}`).length === 1);
  const purgada = runOps("purge-organization.mjs", ["--org", orgC, "--confirm", NAME_C]);
  ok("con el nombre exacto la purga", purgada.code === 0 && (await sql`select 1 from organization where id = ${orgC}`).length === 0, purgada.out);
  ok("…se fue también la cuenta de su Propietario", (await sql`select 1 from "user" where email = ${`c.${RUN}@plataforma.test`}`).length === 0);
  ok("…y la bitácora lo conserva", (await sql`select 1 from platform_audit_log where target_org_id = ${orgC} and action = 'organization.purged'`).length === 1);

  console.log("\n== 8 · Cabeceras de seguridad ==");
  const h = (await A.call("GET", "/login")).headers;
  ok("HSTS de 1 día", h["strict-transport-security"] === "max-age=86400", h["strict-transport-security"]);
  ok("X-Frame-Options: DENY", h["x-frame-options"] === "DENY");
  ok("nosniff", h["x-content-type-options"] === "nosniff");
  ok("Referrer-Policy", h["referrer-policy"] === "strict-origin-when-cross-origin");
  ok("CSP en modo reporte, con frame-ancestors", /frame-ancestors 'none'/.test(h["content-security-policy-report-only"] ?? ""));
  ok("frame-ancestors aplicado", /frame-ancestors 'none'/.test(h["content-security-policy"] ?? ""));
  const rep = await A.call("POST", "/api/csp-report", { "csp-report": { "violated-directive": "img-src", "blocked-uri": "https://evil.example/x.png?tel=5512345678" } });
  ok("/api/csp-report acepta reportes (204)", rep.status === 204);

  console.log(`\n${checks - failures}/${checks} OK`);
  if (failures) console.log(`Fallaron:\n - ${fallas.join("\n - ")}`);
}

/**
 * 036 (PR 4) — B gasta IA de verdad (vista previa de su agente y asistente de
 * redacción, contra el ai-mock) y sube un archivo a Conocimientos; el
 * administrador lo ve en Plataforma → Organizaciones: en la lista (IA del
 * mes, almacenamiento aprox., módulos x/12) y al abrir la fila (por función,
 * por agente y por categoría). Solo lectura y solo para él. También en el
 * celular y en modo oscuro, sin desplazamiento horizontal.
 */
async function consumoEnPlataforma(A, B, orgB) {
  console.log("\n== 4b · Consumo por organización en Plataforma ==");
  const agentes = (await B.call("GET", "/api/lab/agents")).json?.agents ?? [];
  const general = agentes.find((a) => a.isGeneral);
  ok("B tiene su agente general", Boolean(general), JSON.stringify(agentes).slice(0, 200));
  const previa = await B.call("POST", "/api/lab/preview", { agentId: general?.id, config: { displayName: "", useSharedKb: true }, history: [], message: "hola, ¿qué venden?" });
  ok("B usa la vista previa de su agente (gasta IA)", previa.status === 200, `${previa.status} ${JSON.stringify(previa.json).slice(0, 200)}`);
  const redaccion = await B.call("POST", "/api/writing-assist", { action: "improve", text: "hola q tal, le escribo x su pedido" });
  ok("B usa el asistente de redacción (gasta IA, sin agente)", redaccion.status === 200, `${redaccion.status} ${JSON.stringify(redaccion.json).slice(0, 200)}`);
  const archivo = Buffer.from(`Catálogo de prueba ${RUN}\n`.repeat(200));
  const subida = await B.ctx.request.post(`${BASE}/api/knowledge`, {
    multipart: { title: `Catálogo ${RUN}`, file: { name: "catalogo.txt", mimeType: "text/plain", buffer: archivo } },
    failOnStatusCode: false,
  });
  ok("B sube un archivo a Conocimientos", subida.status() === 201, String(subida.status()));

  const lista = (await A.call("GET", "/api/platform/organizations")).json?.organizations ?? [];
  const filaB = lista.find((o) => o.id === orgB);
  ok("la lista trae el consumo del mes de B (2 turnos de IA)", filaB?.usage?.ai?.turns === 2 && filaB?.usage?.ai?.tokens > 0, JSON.stringify(filaB?.usage));
  ok("…y su almacenamiento aproximado (el archivo subido)", filaB?.usage?.storageBytes === archivo.length, `${filaB?.usage?.storageBytes} vs ${archivo.length}`);
  const detalle = (await A.call("GET", `/api/platform/organizations/${orgB}/usage`)).json?.usage;
  ok("el detalle separa por función (Laboratorio y redacción)", detalle?.ai?.byKind?.lab?.turns === 1 && detalle?.ai?.byKind?.writing?.turns === 1, JSON.stringify(detalle?.ai?.byKind));
  ok("…y por agente: el general de B, con su nombre (la redacción no tiene agente)", detalle?.ai?.byAgent?.length === 1 && detalle.ai.byAgent[0].agentId === general?.id && detalle.ai.byAgent[0].name === general?.internalName, JSON.stringify(detalle?.ai?.byAgent));
  ok("…y el almacenamiento por categoría", detalle?.storage?.byCategory?.knowledge === archivo.length);
  ok("B (usuaria común) → 404 en el consumo de su propia organización", (await B.call("GET", `/api/platform/organizations/${orgB}/usage`)).status === 404);
  ok("una organización que no existe → 404", (await A.call("GET", "/api/platform/organizations/org_no_existe/usage")).status === 404);
  ok("el consumo no trae contenido del negocio", !JSON.stringify(detalle).includes("Catálogo de prueba") && !JSON.stringify(detalle).includes("hola"));

  // Escritorio.
  const page = await A.ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/platform/organizaciones`);
  const fila = page.getByTestId(`platform-org-${orgB}`);
  await fila.waitFor({ timeout: 30000 });
  ok("la fila cerrada muestra IA del mes", /tokens/.test(await fila.getByTestId("platform-org-ai").first().innerText()));
  ok("…almacenamiento aproximado («sin tope» hasta los límites)", /KB · sin tope/.test(await fila.getByTestId("platform-org-storage").first().innerText()));
  ok("…y módulos activos «x/12»", /^\d+\/12$/.test((await fila.getByTestId("platform-org-modules-count").last().innerText()).trim()));
  ok("cerrada no muestra los interruptores", (await fila.getByTestId("platform-modules").count()) === 0);
  await fila.getByTestId("platform-org-toggle").click();
  const det = fila.getByTestId("platform-usage-detail");
  await det.waitFor({ timeout: 20000 });
  ok("al abrirla: consumo por agente con el nombre del agente", (await det.getByTestId("platform-usage-agents").innerText()).includes(general?.internalName ?? "?"));
  ok("…por función", /Laboratorio y vista previa/.test(await det.getByTestId("platform-usage-kinds").innerText()) && /Asistente de redacción/.test(await det.getByTestId("platform-usage-kinds").innerText()));
  ok("…almacenamiento por categoría con su nota", /Archivos de Conocimientos/.test(await det.getByTestId("platform-usage-storage").innerText()) && (await det.getByText(/No incluye los mensajes/).count()) === 1);
  ok("…y lo de siempre: módulos, ritmo, personas y estado", (await fila.getByTestId("platform-modules").count()) === 1 && (await fila.getByRole("button", { name: "Personas" }).count()) === 1 && (await fila.getByTestId("platform-suspend").count()) === 1 && (await fila.getByTestId("platform-delete").count()) === 1);
  ok("el buscador filtra por nombre", await (async () => {
    await page.getByTestId("platform-org-search").fill(`zz-no-existe-${RUN}`);
    const vacio = await page.getByText("Ninguna organización coincide.").isVisible();
    await page.getByTestId("platform-org-search").fill(NAME_B);
    return vacio && (await page.getByTestId(`platform-org-${orgB}`).isVisible());
  })());
  await page.close();

  // Celular, modo oscuro: sin desplazamiento horizontal, cerrada y abierta.
  const movil = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, extraHTTPHeaders: { origin: BASE } });
  await movil.addCookies([{ name: "vocero-theme", value: "dark", url: BASE }, ...(await A.ctx.cookies())]);
  const cel = await movil.newPage();
  await cel.goto(`${BASE}/platform/organizaciones`);
  const filaCel = cel.getByTestId(`platform-org-${orgB}`);
  await filaCel.waitFor({ timeout: 30000 });
  const desborde = () =>
    cel.evaluate(() => {
      const els = [document.documentElement, ...document.querySelectorAll("main, [class*='overflow-y-auto']")];
      return els.some((e) => e.scrollWidth > e.clientWidth + 1);
    });
  ok("celular: la lista no se desplaza a lo ancho", !(await desborde()));
  ok("celular: modo oscuro", (await cel.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark");
  await filaCel.getByTestId("platform-org-toggle").click();
  await filaCel.getByTestId("platform-usage-detail").waitFor({ timeout: 20000 });
  ok("celular: la fila abierta tampoco se desplaza a lo ancho", !(await desborde()));
  await cel.screenshot({ path: "scratch/e2e-plataforma-movil-oscuro.png", fullPage: true }).catch(() => null);
  await movil.close();
}

/**
 * 036 (PR 3a) — Plan y topes: el administrador los fija desde Plataforma
 * (personas, almacenamiento en «Bloquear subidas manuales», módulos); la
 * Propietaria choca con cada tope con un mensaje claro, ve el aviso del 80 %
 * y del 100 % en la app y lo marca como visto. La multimedia entrante de
 * WhatsApp nunca se bloquea.
 */
async function topesYAvisos(A, B, orgB) {
  console.log("\n== 4c · Plan y topes ==");
  const subir = async (bytes, nombre) =>
    (
      await B.ctx.request.post(`${BASE}/api/knowledge`, {
        multipart: { title: `${nombre} ${RUN}`, file: { name: `${nombre}.txt`, mimeType: "text/plain", buffer: Buffer.alloc(bytes, "a") } },
        failOnStatusCode: false,
      })
    ).status();
  const usado = (await A.call("GET", `/api/platform/organizations/${orgB}/usage`)).json?.usage?.storage?.totalBytes ?? 0;
  const tope = usado + 10_000;

  // Desde la pantalla: personas = 1 (la Propietaria) y bloqueo de subidas.
  const page = await A.ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/platform/organizaciones`);
  const fila = page.getByTestId(`platform-org-${orgB}`);
  await fila.waitFor({ timeout: 30000 });
  await fila.getByTestId("platform-org-toggle").click();
  const form = fila.getByTestId("platform-limits");
  await form.waitFor({ timeout: 20000 });
  ok("el plan dice «Personalizado»", (await form.getByTestId("platform-plan").inputValue()) === "custom" && /Personalizado/.test(await form.getByTestId("platform-plan").innerText()));
  ok("un tope sin valor propio dice de dónde hereda", /Hereda:/.test(await form.getByTestId("platform-limit-members").getAttribute("placeholder")));
  await form.getByTestId("platform-limit-members").fill("1");
  await form.getByTestId("platform-limit-storageMode").selectOption("block_uploads");
  await form.getByTestId("platform-limits-save").click();
  ok("guardar topes desde la pantalla", await form.getByTestId("platform-limits-saved").waitFor({ timeout: 15000 }).then(() => true, () => false));
  await page.screenshot({ path: "scratch/e2e-plataforma-topes.png", fullPage: false }).catch(() => null);
  // El almacenamiento exacto (en bytes) por la API: la pantalla lo pide en GB.
  const put = await A.call("PUT", `/api/platform/organizations/${orgB}/limits`, { storageBytes: tope });
  ok("la API guarda el tope de almacenamiento", put.status === 200 && put.json?.limits?.storageBytes?.value === tope && put.json?.limits?.storageMode === "block_uploads", JSON.stringify(put.json?.limits).slice(0, 200));
  ok("B (usuaria común) → 404 en los topes", (await B.call("PUT", `/api/platform/organizations/${orgB}/limits`, { members: 50 })).status === 404);
  ok("la bitácora registra el cambio de topes", (await sql`select 1 from platform_audit_log where target_org_id = ${orgB} and action = 'organization.limits_changed'`).length >= 1);

  // Personas: ya tiene 1 (la Propietaria) y el tope es 1.
  const alta = await B.call("POST", "/api/settings/team", { name: "Otra", email: `otra.${RUN}@plataforma.test`, password: "contraseña-larga-123", role: "asesor" });
  ok("tope de personas: no se agrega otra (409 con mensaje claro)", alta.status === 409 && alta.json?.error?.code === "member_limit" && /tope de personas/.test(alta.json?.error?.message ?? ""), `${alta.status} ${JSON.stringify(alta.json)}`);

  // Almacenamiento: cabe lo que no pasa el tope; lo que lo pasaría, no.
  ok("una subida que cabe pasa (Conocimientos)", (await subir(2_000, "cabe")) === 201);
  const grande = await B.ctx.request.post(`${BASE}/api/knowledge`, {
    multipart: { title: `grande ${RUN}`, file: { name: "grande.txt", mimeType: "text/plain", buffer: Buffer.alloc(20_000, "a") } },
    failOnStatusCode: false,
  });
  const cuerpo = await grande.json().catch(() => null);
  ok("la que pasaría el tope se rechaza con mensaje claro (413)", grande.status() === 413 && cuerpo?.error?.code === "storage_limit" && /tope de almacenamiento/.test(cuerpo?.error?.message ?? ""), `${grande.status()} ${JSON.stringify(cuerpo)}`);
  const hilos = (await B.call("GET", "/api/team-chat/threads")).json?.threads ?? [];
  const avisosHilo = hilos.find((t) => t.kind === "announcements");
  const adjunto = await B.ctx.request.post(`${BASE}/api/team-chat/threads/${avisosHilo?.id}/messages`, {
    multipart: { body: "adjunto", file: { name: "pesado.txt", mimeType: "text/plain", buffer: Buffer.alloc(20_000, "b") } },
    failOnStatusCode: false,
  });
  ok("…también un adjunto del chat de equipo", adjunto.status() === 413, String(adjunto.status()));
  ok("subir sin archivo sigue funcionando", (await B.call("POST", "/api/knowledge", { title: `texto ${RUN}`, body: "solo texto" })).status === 201);
  ok("cruza el 80 % con otra subida que cabe", (await subir(6_500, "ochenta")) === 201);

  // Módulos: el tope igual a los activos; encender otro se rechaza.
  const activos = Object.entries((await A.call("GET", "/api/platform/organizations")).json?.organizations?.find((o) => o.id === orgB)?.modules ?? {})
    .filter(([k, v]) => k !== "campaignSendRate" && v === true).length;
  await A.call("PUT", `/api/platform/organizations/${orgB}/limits`, { modules: activos });
  const apagado = Object.entries((await A.call("GET", "/api/platform/organizations")).json?.organizations?.find((o) => o.id === orgB)?.modules ?? {}).find(([k, v]) => k !== "campaignSendRate" && v === false)?.[0];
  const encender = await A.call("POST", `/api/platform/organizations/${orgB}/modules`, { [apagado]: true });
  ok("tope de módulos: encender otro se rechaza (422)", encender.status === 422 && encender.json?.error?.code === "module_limit", `${apagado} ${encender.status} ${JSON.stringify(encender.json)}`);

  // Avisos: la Propietaria los ve en la app y los marca como vistos.
  // El aviso de almacenamiento se revisa al terminar la subida (en segundo plano).
  let avisos = [];
  await hasta(async () => {
    avisos = (await B.call("GET", "/api/usage/alerts")).json?.alerts ?? [];
    return avisos.some((a) => a.metric === "storage");
  });
  const de = (m) => avisos.find((a) => a.metric === m);
  ok("aviso del 100 % de personas", de("members")?.threshold === 100, JSON.stringify(avisos));
  ok("aviso del 80 % de almacenamiento", de("storage")?.threshold === 80, JSON.stringify(avisos));
  ok("aviso del 100 % de módulos (tope = activos)", de("modules")?.threshold === 100, JSON.stringify(avisos));
  const pB = await B.ctx.newPage();
  await pB.goto(`${BASE}/inbox`);
  const banner = pB.getByTestId("usage-alert-banner");
  ok("la Propietaria ve el aviso en la app", await banner.waitFor({ timeout: 30000 }).then(() => true, () => false));
  ok("…con texto claro", /llegó al tope de personas del equipo/.test(await banner.innerText()));
  await pB.screenshot({ path: "scratch/e2e-aviso-propietario.png", fullPage: false }).catch(() => null);
  await banner.getByTestId("usage-alert-seen").click();
  ok("«Entendido» lo oculta", await banner.waitFor({ state: "detached", timeout: 10000 }).then(() => true, () => false));
  ok("…y en el servidor queda visto (ya no sale)", await hasta(async () => ((await B.call("GET", "/api/usage/alerts")).json?.alerts ?? []).length === 0));
  await pB.close();
  await page.reload();
  const filaR = page.getByTestId(`platform-org-${orgB}`);
  await filaR.waitFor({ timeout: 30000 });
  ok("el administrador ve el aviso en la fila", /100 %/.test((await filaR.getByTestId("platform-org-alert").innerText().catch(() => "")) ?? ""));
  await page.close();

  // La multimedia entrante de WhatsApp se guarda siempre (nunca se bloquea).
  ok(
    "WhatsApp entrante sigue entrando con el tope pasado",
    (await A.call("POST", "/api/dev/wa-mock/inbound", { phoneNumberId: PN_B, from: "5215577001199", name: "Cliente con tope", text: `tras el tope ${RUN}`, waMessageId: `wamid.plat.tope.${RUN}` })).status === 200 &&
      (await hasta(async () => (await sql`select 1 from message where organization_id = ${orgB} and text = ${`tras el tope ${RUN}`}`).length > 0))
  );

  // Deja a B sin topes propios para el resto del guion.
  const reset = await A.call("PUT", `/api/platform/organizations/${orgB}/limits`, { members: null, storageBytes: null, storageMode: "warn", modules: null });
  ok("volver a heredar (sin topes propios)", reset.json?.limits?.members?.source === "none" && reset.json?.limits?.storageMode === "warn");
}

/**
 * 036 (PR 3b) — Costos: el administrador captura precios (USD por millón de
 * tokens) y el tipo de cambio con «vigente desde»; el panel muestra por
 * organización el costo estimado, el real que reportó el proveedor
 * (`usage.cost` del ai-mock, a $3/$15 como OpenRouter) y la proyección del
 * mes, en USD y MXN. Solo él lo ve; nunca contenido.
 */
async function costosEnPlataforma(A, B, orgB) {
  console.log("\n== 4d · Costos de IA en Plataforma ==");
  const [real] = await sql`
    select coalesce(sum(cost_usd), 0)::float8 as usd, coalesce(sum(prompt_tokens + completion_tokens), 0)::int as tokens
    from ai_usage where organization_id = ${orgB} and period = to_char(date_trunc('month', now() at time zone 'utc'), 'YYYY-MM-DD') and kind <> 'total'`;
  ok("el costo real que reportó el proveedor quedó en cost_usd", real.usd > 0 && real.tokens > 0, JSON.stringify(real));

  const page = await A.ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/platform`);
  await page.getByRole("navigation", { name: "Secciones de Plataforma" }).getByRole("link", { name: "Costos" }).click();
  await page.waitForURL(/\/platform\/costos$/);
  const form = page.getByTestId("platform-pricing");
  await form.waitFor({ timeout: 30000 });
  const hoy = new Date().toISOString().slice(0, 10);
  await form.getByTestId("platform-price-chatIn").fill("3");
  await form.getByTestId("platform-price-chatOut").fill("15");
  await form.getByTestId("platform-price-judgeIn").fill("");
  await form.getByTestId("platform-price-judgeOut").fill("");
  await form.getByTestId("platform-price-embed").fill("0.02");
  await form.getByTestId("platform-price-rate").fill("18.5");
  await form.getByTestId("platform-price-currency").fill("MXN");
  await form.getByTestId("platform-price-validFrom").fill(hoy);
  await form.getByTestId("platform-pricing-save").click();
  await form.getByTestId("platform-pricing-saved").waitFor({ timeout: 20000 });
  ok("captura precios y tipo de cambio desde la pantalla", true);
  ok("…y el historial marca el vigente desde hoy", /vigente/.test(await form.getByTestId("platform-pricing-history").innerText()));
  await form.screenshot({ path: "scratch/e2e-plataforma-precios.png" }).catch(() => null);

  const rep = (await A.call("GET", "/api/platform/costs")).json?.report;
  const filaB = rep?.rows?.find((r) => r.organizationId === orgB);
  ok("el panel usa el precio recién capturado", rep?.pricing?.chatInputUsdPerMtok === 3 && rep?.pricing?.usdToLocal === 18.5 && rep?.pricing?.localCurrency === "MXN", JSON.stringify(rep?.pricing));
  ok("Real de B = lo que reportó el proveedor", Math.abs((filaB?.realUsd ?? -1) - real.usd) < 1e-6, `${filaB?.realUsd} vs ${real.usd}`);
  ok("Estimado de B ≈ Real (mismos precios que el mock)", Math.abs((filaB?.estimatedUsd ?? -1) - (filaB?.realUsd ?? 0)) < 1e-4, `${filaB?.estimatedUsd} vs ${filaB?.realUsd}`);
  ok("proyección del mes ≥ lo gastado (el mayor de estimado y real)", (filaB?.projectedUsd ?? 0) >= Math.max(filaB?.realUsd ?? 1, filaB?.estimatedUsd ?? 1) - 1e-9, JSON.stringify(filaB));
  ok("desglose por función (Laboratorio y redacción)", ["lab", "writing"].every((k) => filaB?.byKind?.some((x) => x.kind === k)), JSON.stringify(filaB?.byKind));
  ok("el panel no trae contenido del negocio", !JSON.stringify(rep).includes("hola") && !JSON.stringify(rep).includes("pedido"));

  await page.reload();
  const filaUi = page.getByTestId(`platform-cost-org-${orgB}`);
  await filaUi.waitFor({ timeout: 30000 });
  const textoFila = await filaUi.innerText();
  ok("la fila muestra USD y MXN", /USD/.test(textoFila) && /MXN/.test(textoFila), textoFila.slice(0, 200));
  ok("los totales del mes: estimado, real y proyección", (await page.getByTestId("platform-cost-total-real").innerText()).includes("USD") && (await page.getByTestId("platform-cost-total-projected").innerText()).includes("MXN"));
  await filaUi.getByRole("button").first().click();
  ok("al abrirla, el desglose por función", /Asistente de redacción/.test(await filaUi.getByTestId("platform-cost-kinds").innerText()));
  await page.screenshot({ path: "scratch/e2e-plataforma-costos.png", fullPage: true }).catch(() => null);
  await page.close();

  // Validación y acceso.
  ok("precio negativo → 422", (await A.call("POST", "/api/platform/pricing", { chatInputUsdPerMtok: -1, chatOutputUsdPerMtok: 1, judgeInputUsdPerMtok: null, judgeOutputUsdPerMtok: null, embedUsdPerMtok: 0, usdToLocal: 18, localCurrency: "MXN" })).status === 422);
  ok("moneda que no es de 3 letras → 422", (await A.call("POST", "/api/platform/pricing", { chatInputUsdPerMtok: 1, chatOutputUsdPerMtok: 1, judgeInputUsdPerMtok: null, judgeOutputUsdPerMtok: null, embedUsdPerMtok: 0, usdToLocal: 18, localCurrency: "pesos" })).status === 422);
  ok("B (usuaria común) → 404 en costos y precios", (await B.call("GET", "/api/platform/costs")).status === 404 && (await B.call("GET", "/api/platform/pricing")).status === 404);
  const pB = await B.ctx.newPage();
  const resp = await pB.goto(`${BASE}/platform/costos`);
  ok("B → la página de costos no existe (404)", resp?.status() === 404);
  await pB.close();
  const bit = (await A.call("GET", "/api/platform/audit")).json?.entries ?? [];
  ok("el cambio de precios queda en la bitácora", bit.some((e) => e.action === "pricing.changed"));

  // Celular, modo oscuro.
  const movil = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, extraHTTPHeaders: { origin: BASE } });
  await movil.addCookies([{ name: "vocero-theme", value: "dark", url: BASE }, ...(await A.ctx.cookies())]);
  const cel = await movil.newPage();
  await cel.goto(`${BASE}/platform/costos`);
  await cel.getByTestId(`platform-cost-org-${orgB}`).waitFor({ timeout: 30000 });
  const desborde = await cel.evaluate(() => {
    const els = [document.documentElement, ...document.querySelectorAll("main, [class*='overflow-y-auto']")];
    return els.some((e) => e.scrollWidth > e.clientWidth + 1);
  });
  ok("celular: costos sin desplazamiento horizontal", !desborde);
  await cel.screenshot({ path: "scratch/e2e-plataforma-costos-movil.png", fullPage: true }).catch(() => null);
  await movil.close();
}

try {
  await main();
} catch (err) {
  failures++;
  console.error("ERROR", err);
} finally {
  await browser.close();
  await sql.end();
}
process.exit(failures ? 1 : 0);
