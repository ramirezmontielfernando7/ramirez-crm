/**
 * Self-test E2E de la Fase 3, PR 1 — credenciales y webhooks
 * (tests/e2e/us-credenciales.md). Contra la app real con los mocks:
 *
 *  - H8/H25: la conexión manual valida los IDs, que el número sea de la WABA
 *    declarada, y responde 409 claro (no 500) si el número o la WABA ya son
 *    de OTRA organización.
 *  - Un evento de un número que nadie conectó se guarda en webhook_unrouted,
 *    cifrado (el texto del cliente no aparece en la fila).
 *  - Cuota de IA: con el tope agotado, el asistente de redacción responde 429
 *    y el agente pasa la conversación a una persona con motivo `cuota`, sin
 *    llamar al modelo.
 *  - Zernio sin secreto: 401 (solo si Messenger está encendido).
 *
 * Uso:
 *   1) app corriendo con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock,
 *      OPENROUTER_BASE_URL → ai-mock (y OPENROUTER_API_TOKEN/MODEL con
 *      cualquier valor para la parte de IA) y BD migrada.
 *   2) node --env-file=.env scripts/e2e-credenciales.mjs
 *
 * Re-ejecutable. Sale con 1 si algo falla.
 */
import { createHmac, randomBytes } from "node:crypto";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const OWNER_A = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
const OWNER_B = { email: "owner.b.cred@vocero.test", password: "password-e2e-cred-123", name: "Propietaria B Cred" };
const SLUG_B = "e2e-cred-b";
const PN_A = "PN-E2E-CRED-A";
const WABA_A = "WABA-E2E-CRED-A";
const PN_B = "PN-E2E-CRED-B";
const WABA_B = "WABA-E2E-CRED-B";
const TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN;

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

let clientes = 0;
function cliente(nombre) {
  let cookie = "";
  clientes++;
  const ip = `10.77.${Number(RUN.slice(-3)) % 256}.${clientes}`;
  async function api(path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
      redirect: "manual",
      ...opts,
      headers: {
        ...(typeof opts.body === "string" ? { "content-type": "application/json" } : {}),
        origin: BASE,
        "x-forwarded-for": ip,
        ...(cookie ? { cookie } : {}),
        ...(opts.headers ?? {}),
      },
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // no es JSON
    }
    return { status: res.status, json, text };
  }
  return { nombre, api };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 20000, paso = 400) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}

async function entrar(c, { email, password, name }) {
  let r;
  for (let intento = 0; intento < 10; intento++) {
    r = await c.api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
    if (r.status !== 429) break;
    await sleep(3000);
  }
  if (r.status >= 400 && name) {
    r = await c.api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name }) });
  }
  return r.status < 400;
}

const sql = postgres(process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL, { max: 2, onnotice: () => {} });
const nid = (p) => `${p}_${randomBytes(12).toString("hex").slice(0, 20)}`;

async function asegurarOrganizacionB() {
  const [fila] = await sql`select id from "organization" where slug = ${SLUG_B}`;
  if (fila) return fila.id;
  const id = nid("org");
  await sql.begin(async (tx) => {
    await tx`insert into "organization" (id, name, slug, created_at) values (${id}, 'Negocio B Credenciales', ${SLUG_B}, now())`;
    for (const [i, [name, kind]] of [["Nuevo", "open"], ["Cliente", "won"], ["Perdido", "lost"]].entries()) {
      await tx`insert into "pipeline_stage" (id, organization_id, name, position, kind) values (${nid("stg")}, ${id}, ${name}, ${i}, ${kind})`;
    }
    await tx`insert into "agent_profile" (id, organization_id) values (${nid("agp")}, ${id})`;
  });
  return id;
}

const conectar = (c, body) => c.api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify(body) });

async function main() {
  const A = cliente("propietario A");
  const B = cliente("propietaria B");

  console.log("== Setup ==");
  ok("propietario A entra", await entrar(A, OWNER_A));
  const [{ organization_id: orgA } = {}] = await sql`
    select m.organization_id from "member" m join "user" u on u.id = m.user_id where u.email = ${OWNER_A.email}`;
  const orgB = await asegurarOrganizacionB();
  const [yaB] = await sql`select id from "user" where email = ${OWNER_B.email}`;
  if (!yaB) {
    const alta = await A.api("/api/settings/team", {
      method: "POST",
      body: JSON.stringify({ name: OWNER_B.name, email: OWNER_B.email, password: OWNER_B.password, role: "coordinador" }),
    });
    ok("alta de la propietaria B", alta.status === 201, alta.text);
  }
  await sql`update "member" set organization_id = ${orgB}, role = 'owner' where user_id = (select id from "user" where email = ${OWNER_B.email})`;
  ok("propietaria B entra (en su organización)", await entrar(B, OWNER_B));

  console.log("\n== H8/H25: conexión manual ==");
  const raro = await conectar(A, { wabaId: "1029;drop", phoneNumberId: PN_A, token: "tok-cred-a" });
  ok("un WABA ID con caracteres raros → 422 invalid_waba_id", raro.status === 422 && raro.json?.error?.code === "invalid_waba_id", raro.text);

  const ajena = await conectar(A, { wabaId: `WABA-AJENA-${RUN}`, phoneNumberId: PN_A, token: "tok-cred-a" });
  ok(
    "un número que no es de esa WABA → 422 phone_not_in_waba (con mensaje claro)",
    ajena.status === 422 && ajena.json?.error?.code === "phone_not_in_waba" && /no pertenece/.test(ajena.json?.error?.message ?? ""),
    ajena.text
  );

  const sinPermiso = await conectar(A, { wabaId: WABA_A, phoneNumberId: PN_A, token: "tok-cred-a-noperm" });
  ok("un token sin whatsapp_business_management → 422 missing_permission", sinPermiso.status === 422 && sinPermiso.json?.error?.code === "missing_permission", sinPermiso.text);

  const buena = await conectar(A, { wabaId: WABA_A, phoneNumberId: PN_A, token: "tok-cred-a" });
  ok("A conecta su número de su WABA", buena.status === 200, buena.text);

  const robaNumero = await conectar(B, { wabaId: WABA_B, phoneNumberId: PN_A, token: "tok-cred-b" });
  ok("B con el número de A → 409 phone_in_use (no 500)", robaNumero.status === 409 && robaNumero.json?.error?.code === "phone_in_use", robaNumero.text);

  const robaWaba = await conectar(B, { wabaId: WABA_A, phoneNumberId: PN_B, token: "tok-cred-b" });
  ok("B con la WABA de A → 409 waba_in_use (no 500)", robaWaba.status === 409 && robaWaba.json?.error?.code === "waba_in_use", robaWaba.text);

  const buenaB = await conectar(B, { wabaId: WABA_B, phoneNumberId: PN_B, token: "tok-cred-b" });
  ok("B conecta lo suyo", buenaB.status === 200, buenaB.text);

  const [wabas] = await sql`
    select count(*) filter (where waba_id = ${WABA_A} and organization_id = ${orgA})::int as a,
           count(*) filter (where waba_id = ${WABA_B} and organization_id = ${orgB})::int as b,
           count(*) filter (where waba_id in (${WABA_A}, ${WABA_B}))::int as total
    from "whatsapp_business_account"`;
  ok("cada WABA quedó registrada una vez, en su organización", wabas.a === 1 && wabas.b === 1 && wabas.total === 2, JSON.stringify(wabas));

  const estadoA = await A.api("/api/settings/whatsapp");
  ok("A sigue con su conexión intacta tras los intentos de B", estadoA.json?.connection?.phoneNumberId === PN_A, estadoA.text);

  console.log("\n== webhook_unrouted ==");
  const PN_NADIE = `PN-E2E-NADIE-${RUN}`;
  const SECRETO = `texto-del-cliente-${RUN}`;
  const inb = await A.api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN_NADIE, from: "5215599990000", text: SECRETO, waMessageId: `wamid.e2e.cred.${RUN}` }),
  });
  ok("el webhook acepta el evento (200) aunque el número no sea de nadie", inb.status === 200, inb.text);
  const guardado = await hasta(async () => (await sql`select 1 from "webhook_unrouted" where route_key = ${PN_NADIE}`).length === 1);
  ok("queda guardado en webhook_unrouted", guardado);
  const [fila] = await sql`select * from "webhook_unrouted" where route_key = ${PN_NADIE}`;
  ok("…cifrado: el texto del cliente no aparece en la fila", fila && !JSON.stringify(fila).includes(SECRETO));
  const [enA] = await sql`select count(*)::int as n from "message" where organization_id = ${orgA} and text = ${SECRETO}`;
  ok("…y no entró a ninguna organización", enA.n === 0);

  console.log("\n== Cuota de IA ==");
  const disponible = (await A.api("/api/writing-assist")).json?.available === true;
  if (!disponible) {
    console.log("  (omitido) la IA no está configurada en esta instancia (OPENROUTER_API_TOKEN)");
  } else {
    await sql`insert into "ai_quota" (organization_id, monthly_turn_limit) values (${orgA}, 0)
              on conflict (organization_id) do update set monthly_turn_limit = 0, monthly_token_limit = null`;
    const red = await A.api("/api/writing-assist", {
      method: "POST",
      body: JSON.stringify({ action: "tone", tone: "formal", text: "hola, ¿cómo estás? te escribo por lo del pedido" }),
    });
    ok("asistente de redacción con la cuota agotada → 429 quota_exceeded", red.status === 429 && red.json?.error?.code === "quota_exceeded", red.text);

    // El agente: un lead nuevo escribe y, sin cuota, se pasa a una persona.
    await A.api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: true }) });
    const TEL = `5214629${RUN.slice(-6)}`;
    const CANON = `524629${RUN.slice(-6)}`;
    const salidasAntes = ((await A.api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).filter((o) => o.to === CANON).length;
    const turnos = async () =>
      (await sql`select coalesce(sum(turns), 0)::int as n from "ai_usage" where organization_id = ${orgA} and kind = 'total'`)[0].n;
    const turnosAntes = await turnos();
    await A.api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({ phoneNumberId: PN_A, from: TEL, name: "Lead sin cuota", text: "¿qué precio tiene el plan anual?", waMessageId: `wamid.e2e.cuota.${RUN}` }),
    });
    const convDe = async () => ((await A.api("/api/conversations")).json?.conversations ?? []).find((c) => c.contact.phone === CANON);
    await hasta(async () => Boolean((await convDe())?.handoffAt));
    const conv = await convDe();
    ok("el agente sin cuota pasa la conversación a una persona (motivo `cuota`)", conv?.handoffReason === "cuota", JSON.stringify({ handoffAt: conv?.handoffAt, reason: conv?.handoffReason }));
    const salidasDespues = ((await A.api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).filter((o) => o.to === CANON).length;
    ok("…y no le contestó nada al cliente con IA", salidasDespues === salidasAntes);
    ok("…y no se contó ningún turno (no se llamó al modelo)", (await turnos()) === turnosAntes);

    // Se quita el tope y se apaga el agente: lo demás sigue como estaba.
    await sql`delete from "ai_quota" where organization_id = ${orgA}`;
    await A.api("/api/agent/profile", { method: "PUT", body: JSON.stringify({ enabled: false }) });
    const red2 = await A.api("/api/writing-assist", {
      method: "POST",
      body: JSON.stringify({ action: "tone", tone: "formal", text: "hola, ¿cómo estás? te escribo por lo del pedido" }),
    });
    ok("sin tope, el asistente vuelve a responder", red2.status === 200, red2.text);
    const [uso2] = await sql`select turns, prompt_tokens + completion_tokens as t from "ai_usage" where organization_id = ${orgA} and kind = 'total' and period = to_char(now() at time zone 'utc', 'YYYY-MM-01')`;
    ok("…y su turno y sus tokens quedan contados", (uso2?.turns ?? 0) >= 1 && Number(uso2?.t ?? 0) > 0, JSON.stringify(uso2));
  }

  console.log("\n== Zernio sin secreto ==");
  const fb = await fetch(`${BASE}/api/webhooks/messenger/${TOKEN}`, { method: "GET" });
  if (fb.status === 404) {
    console.log("  (omitido) Messenger no está encendido en esta instancia (CHANNELS)");
  } else {
    const ACC = `acc-e2e-sin-secreto-${RUN}`;
    await sql`delete from "messenger_credentials" where organization_id = ${orgB}`;
    await sql`insert into "messenger_credentials" (id, organization_id, source, account_ref, token_cipher, token_iv, token_tag)
              values (${nid("cred")}, ${orgB}, 'zernio', ${ACC}, 'x', 'x', 'x')`;
    const evento = JSON.stringify({ event: "message.received", account: { id: ACC, platform: "facebook" }, message: { id: `m-${RUN}`, text: "hola" } });
    const firma = createHmac("sha256", "cualquier-secreto").update(evento).digest("hex");
    const r = await fetch(`${BASE}/api/webhooks/messenger/${TOKEN}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-zernio-signature": firma },
      body: evento,
    });
    ok("una cuenta de Zernio SIN secreto guardado → 401", r.status === 401, String(r.status));
    await sql`delete from "messenger_credentials" where organization_id = ${orgB}`;
  }

  console.log(`\n${checks - failures}/${checks} OK`);
  if (failures) console.log(`Fallaron:\n - ${fallas.join("\n - ")}`);
}

try {
  await main();
} catch (err) {
  failures++;
  console.error("ERROR", err);
} finally {
  await sql.end();
}
process.exit(failures ? 1 : 0);
