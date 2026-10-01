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
