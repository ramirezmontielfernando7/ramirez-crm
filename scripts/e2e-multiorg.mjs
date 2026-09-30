/**
 * Self-test E2E de la Fase 1 multitenant — DOS organizaciones en la misma
 * instancia (tests/e2e/us-multiorg.md).
 *
 * La organización B siembra un recurso de cada tipo (contacto, conversación,
 * mensaje, adjunto, lead, etapa, etiqueta, conocimiento, base del agente,
 * plantilla, campaña, cita, chat de equipo). Después cada rol de A
 * (Propietario, Coordinador, Asesor) intenta leer, escribir, borrar y
 * enumerar esos recursos por la API, y escucha el SSE mientras B trabaja.
 * Todo debe responder 404 (o 403 si su rol no tiene el permiso, antes de
 * buscar nada) y los datos de B deben quedar idénticos byte a byte.
 *
 * Además cubre las superficies "primera organización" del diagnóstico: el
 * cerebro externo (H2), la organización activa (H4), el token del webhook
 * (H7), la marca del login (H11) y el correo del alta de miembros (H13).
 *
 * Uso:
 *   1) app corriendo con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock,
 *      OPENROUTER_BASE_URL → ai-mock, CAMPAIGNS=on, AGENDA=on y BD migrada.
 *      Para la parte de plataforma, PLATFORM_ORG_ID = la organización de
 *      e2e@vocero.test (el script la imprime si falta).
 *   2) node --env-file=.env scripts/e2e-multiorg.mjs
 *
 * La organización B se crea por SQL (el alta de organizaciones con UI es de
 * la Fase 3). Re-ejecutable: reutiliza cuentas y organización, y cada
 * corrida siembra recursos nuevos. Sale con 1 si algo falla.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const PASSWORD = "password-e2e-multiorg-123";
const OWNER_A = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
const PN_A = "PN-E2E-MO-A";
const PN_B = "PN-E2E-MO-B";
const WABA_A = "WABA-E2E-MO-A";
const WABA_B = "WABA-E2E-MO-B";
const SLUG_B = "e2e-multiorg-b";
/** Marca que solo aparece en datos de B: si sale en una respuesta a A, fuga. */
const SECRETO_B = `SECRETO-B-${RUN}`;
const MARCA_A = `Marca A ${RUN}`.slice(0, 30);

let failures = 0;
let checks = 0;
const fallas = [];

function ok(name, cond, extra = "") {
  checks++;
  if (cond) {
    console.log(`  OK  ${name}`);
  } else {
    failures++;
    fallas.push(name);
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

/**
 * Un cliente HTTP con su propia cookie: una persona distinta cada uno. Cada
 * una "llega" desde su propia IP (como hace e2e-selftest.mjs): el límite de
 * 10 logins por IP cada 10 minutos (FR-062) sigue en pie, pero siete
 * personas entrando desde la misma máquina, dos corridas seguidas, no deben
 * chocar con él.
 */
let clientes = 0;
function cliente(nombre) {
  let cookie = "";
  clientes++;
  const ip = `10.${Number(RUN.slice(0, 2))}.${Number(RUN.slice(2, 5)) % 256}.${clientes}`;
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
      // no es JSON (binario, HTML): se usa `text`
    }
    return { status: res.status, json, text };
  }
  return { nombre, api, cookie: () => cookie };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 15000, paso = 400) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}

async function entrar(c, email, password, name) {
  // better-auth limita los intentos de login por IP (429): se espera y se
  // reintenta, porque aquí entran seis personas desde la misma máquina.
  let r;
  for (let intento = 0; intento < 10; intento++) {
    r = await c.api("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (r.status !== 429) break;
    await sleep(3000);
  }
  if (r.status >= 400 && name) {
    r = await c.api("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    });
  }
  return r.status < 400;
}

/** Abre /api/events y junta lo que llegue. `cerrar()` devuelve el texto crudo. */
function escuchar(c) {
  const ctl = new AbortController();
  let crudo = "";
  const listo = (async () => {
    try {
      const res = await fetch(`${BASE}/api/events`, {
        headers: { cookie: c.cookie() },
        signal: ctl.signal,
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        crudo += dec.decode(value, { stream: true });
      }
    } catch (err) {
      if (err?.name !== "AbortError") console.log(`  (SSE de ${c.nombre} cortado: ${err?.message ?? err})`);
    }
  })();
  return {
    cerrar: async () => {
      ctl.abort();
      await listo;
      return crudo;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL: solo para lo que la app todavía no tiene UI (crear la organización B)
// y para comprobar que los datos de B no cambiaron.
// ---------------------------------------------------------------------------

const sql = postgres(process.env.DATABASE_URL, { max: 2, onnotice: () => {} });

function nid(prefijo) {
  return `${prefijo}_${randomBytes(12).toString("hex").slice(0, 20)}`;
}

async function asegurarOrganizacionB() {
  const [fila] = await sql`select id from "organization" where slug = ${SLUG_B}`;
  if (fila) return fila.id;
  const id = nid("org");
  await sql.begin(async (tx) => {
    await tx`insert into "organization" (id, name, slug, created_at) values (${id}, 'Negocio B E2E', ${SLUG_B}, now())`;
    const etapas = [
      ["Nuevo", "open"],
      ["En conversación", "open"],
      ["Cliente", "won"],
      ["Perdido", "lost"],
    ];
    for (const [i, [name, kind]] of etapas.entries()) {
      await tx`insert into "pipeline_stage" (id, organization_id, name, position, kind) values (${nid("stg")}, ${id}, ${name}, ${i}, ${kind})`;
    }
    await tx`insert into "agent_profile" (id, organization_id) values (${nid("agp")}, ${id})`;
  });
  return id;
}

async function orgDeUsuario(email) {
  const filas = await sql`
    select m.organization_id from "member" m join "user" u on u.id = m.user_id
    where u.email = ${email} order by m.created_at, m.id`;
  return filas.map((f) => f.organization_id);
}

/**
 * Huella de TODO lo de una organización en las tablas de dominio: si un
 * ataque de A escribe, borra o cuelga algo de B, la huella cambia.
 */
async function huella(orgId) {
  const tablas = await sql`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'organization_id'
    order by table_name`;
  const out = {};
  for (const { table_name } of tablas) {
    const [r] = await sql.unsafe(
      `select count(*)::int as n, coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as h
       from "${table_name}" t where organization_id = $1`,
      [orgId]
    );
    out[table_name] = `${r.n}:${r.h}`;
  }
  return out;
}

function diferencias(a, b) {
  return Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]);
}

// ---------------------------------------------------------------------------

async function main() {
  const ownerA = cliente("propietario A");
  const coordA = cliente("coordinador A");
  const asesorA = cliente("asesor A");
  const ownerB = cliente("propietario B");
  const coordB = cliente("coordinador B");
  const asesorB = cliente("asesor B");
  const anon = cliente("anónimo");

  console.log("== Setup: organización A (la de e2e@vocero.test) ==");
  ok("propietario A entra", await entrar(ownerA, OWNER_A.email, OWNER_A.password, OWNER_A.name));
  const [orgA] = await orgDeUsuario(OWNER_A.email);
  ok("A tiene organización", Boolean(orgA));
  if (process.env.PLATFORM_ORG_ID !== orgA) {
    console.log(`  (aviso) PLATFORM_ORG_ID=${process.env.PLATFORM_ORG_ID ?? "(vacía)"}; la organización de A es ${orgA}.`);
  }
  const esPlataformaA = process.env.PLATFORM_ORG_ID === orgA;
  const conn = await ownerA.api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: WABA_A, phoneNumberId: PN_A, token: "tok-mo-a" }),
  });
  ok("A conecta su WhatsApp (wa-mock)", conn.status < 400, conn.text);
  const marca = await ownerA.api("/api/settings/branding", {
    method: "PUT",
    body: JSON.stringify({ name: MARCA_A, accent: "#12999d", currency: "MXN" }),
  });
  ok("A pone su marca", marca.status < 400, marca.text);

  // Cuentas: el propietario A las da de alta (la única alta de cuentas que
  // existe hoy) y el script pasa las de B a la organización B.
  const cuentas = {
    coordA: ["coord.a.mo@vocero.test", "Coordinadora A MO", "coordinador", coordA],
    asesorA: ["asesor.a.mo@vocero.test", "Asesor A MO", "asesor", asesorA],
    ownerB: ["owner.b.mo@vocero.test", "Propietaria B MO", "owner", ownerB],
    coordB: ["coord.b.mo@vocero.test", "Coordinador B MO", "coordinador", coordB],
    asesorB: ["asesor.b.mo@vocero.test", "Asesora B MO", "asesor", asesorB],
  };
  const orgB = await asegurarOrganizacionB();
  for (const [clave, [email, name, role]] of Object.entries(cuentas)) {
    const yaExiste = (await orgDeUsuario(email)).length > 0;
    if (!yaExiste) {
      const alta = await ownerA.api("/api/settings/team", {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          password: PASSWORD,
          role: role === "owner" ? "coordinador" : role,
        }),
      });
      ok(`alta de ${clave}`, alta.status === 201, `status=${alta.status} ${alta.text}`);
    }
    const destino = clave.endsWith("B") ? orgB : orgA;
    // Una sola membresía, en su organización y con su rol (re-corridas incluidas).
    await sql`
      update "member" set organization_id = ${destino}, role = ${role}
      where user_id = (select id from "user" where email = ${email})`;
    await sql`
      delete from "member" m using "member" otro
      where m.user_id = otro.user_id and m.user_id = (select id from "user" where email = ${email})
        and m.id > otro.id`;
  }
  for (const [clave, [email, , , c]] of Object.entries(cuentas)) {
    ok(`${clave} inicia sesión`, await entrar(c, email, PASSWORD));
  }
  const idUsuario = async (email) => (await sql`select id from "user" where email = ${email}`)[0]?.id;
  const uid = {};
  for (const [clave, [email]] of Object.entries(cuentas)) uid[clave] = await idUsuario(email);

  console.log("\n== B siembra un recurso de cada tipo ==");
  const connB = await ownerB.api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: WABA_B, phoneNumberId: PN_B, token: "tok-mo-b" }),
  });
  ok("B conecta su WhatsApp (wa-mock)", connB.status < 400, connB.text);
  await ownerB.api("/api/settings/branding", {
    method: "PUT",
    body: JSON.stringify({ name: `Marca B ${RUN}`.slice(0, 30), accent: "#aa3355", currency: "MXN" }),
  });
  const telB = `52155${RUN}88`;
  const nombreB = `Cliente ${SECRETO_B}`;
  const inB = await ownerB.api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN_B, from: telB, name: nombreB, text: `hola ${SECRETO_B}`, waMessageId: `wamid.mo.b.${RUN}` }),
  });
  ok("mensaje entrante a B", inB.status < 400, inB.text);
  let convB = null;
  await hasta(async () => {
    convB = ((await ownerB.api("/api/conversations")).json?.conversations ?? []).find((c) => c.contact?.name === nombreB) ?? null;
    return convB;
  });
  ok("B ve su conversación", Boolean(convB));
  await ownerB.api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN_B, from: telB, type: "image", mediaId: "media-e2e-img-1", caption: SECRETO_B, waMessageId: `wamid.mo.b.img.${RUN}` }),
  });
  let assetB = null;
  let msgB = null;
  await hasta(async () => {
    const msgs = (await ownerB.api(`/api/conversations/${convB?.id}/messages`)).json?.messages ?? [];
    msgB = msgs.find((m) => m.direction === "in") ?? null;
    assetB = msgs.find((m) => m.media?.fetchStatus === "available")?.media?.assetId ?? null;
    return assetB;
  });
  ok("B tiene un adjunto descargado", Boolean(assetB));
  const contactB = convB?.contact?.id;
  const board = (await ownerB.api("/api/pipeline/board")).json ?? {};
  const leadB = (board.leads ?? []).find((l) => l.contactId === contactB || l.contact?.id === contactB)?.id ?? board.leads?.[0]?.id;
  const stageB = board.stages?.[0]?.id;
  ok("B tiene lead y etapas", Boolean(leadB && stageB), JSON.stringify(board).slice(0, 200));

  const tag = await ownerB.api("/api/contact-tags", { method: "POST", body: JSON.stringify({ name: `tag ${SECRETO_B}` }) });
  const tagB = tag.json?.tag?.id;
  ok("B crea una etiqueta", Boolean(tagB), tag.text);
  const kn = await ownerB.api("/api/knowledge", { method: "POST", body: JSON.stringify({ title: `Conocimiento ${SECRETO_B}`, body: SECRETO_B }) });
  const knowledgeB = kn.json?.entry?.id;
  ok("B crea un conocimiento", Boolean(knowledgeB), kn.text);
  const kb = await ownerB.api("/api/kb", { method: "POST", body: JSON.stringify({ kind: "qa", question: `¿${SECRETO_B}?`, answer: SECRETO_B }) });
  const kbB = kb.json?.entry?.id ?? kb.json?.id;
  ok("B crea una entrada de la base del agente", Boolean(kbB), kb.text);
  const tplName = `mo_b_${RUN}`;
  const tpl = await ownerB.api("/api/templates", {
    method: "POST",
    body: JSON.stringify({ name: tplName, language: "es_MX", category: "UTILITY", body: `Aviso ${SECRETO_B}` }),
  });
  const tplB = tpl.json?.template?.id;
  ok("B crea una plantilla", Boolean(tplB), tpl.text);
  await ownerB.api("/api/dev/wa-mock/template-status", {
    method: "POST",
    body: JSON.stringify({ wabaId: WABA_B, name: tplName, language: "es_MX", event: "APPROVED", notify: false }),
  });
  // La aprobación llega por la sincronización con Meta (wa-mock): se espera a
  // que la plantilla quede aprobada antes de armar la campaña.
  const aprobada = await hasta(async () => {
    await ownerB.api("/api/templates/sync", { method: "POST" });
    const lista = (await ownerB.api("/api/templates")).json?.templates ?? [];
    return lista.some((t) => t.id === tplB && t.status === "approved");
  }, 20000, 1000);
  ok("la plantilla de B queda aprobada (sync con wa-mock)", aprobada);
  const cmp = await ownerB.api("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({ name: `Campaña ${SECRETO_B}`, templateId: tplB, variables: [], audience: {} }),
  });
  const campaignB = cmp.json?.campaign?.id;
  ok("B crea una campaña (borrador)", Boolean(campaignB), cmp.text);
  await ownerB.api("/api/calendar/settings", {
    method: "PUT",
    body: JSON.stringify({
      timezone: "America/Mexico_City",
      weeklyHours: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [{ start: "00:00", end: "23:30" }]])),
      slotMinutes: 30,
      minNoticeHours: 0,
      maxDaysAhead: 30,
      connector: "enlace-fijo",
      meetingLink: "https://meet.ejemplo.test/b",
    }),
  });
  // Un hueco distinto en cada corrida (re-ejecutable sin "horario ocupado").
  const inicio = new Date(Date.now() + 3 * 86400000);
  inicio.setUTCHours(0, 0, 0, 0);
  inicio.setTime(inicio.getTime() + (Number(RUN) % 400) * 30 * 60000);
  const bk = await ownerB.api("/api/bookings", {
    method: "POST",
    body: JSON.stringify({ kind: "block", startUtc: inicio.toISOString(), durationMinutes: 30, notes: SECRETO_B }),
  });
  const bookingB = bk.json?.booking?.id;
  ok("B crea una cita", Boolean(bookingB), bk.text);
  const grp = await ownerB.api("/api/team-chat/groups", {
    method: "POST",
    body: JSON.stringify({ name: `Grupo ${RUN}`, memberIds: [uid.coordB] }),
  });
  const threadB = grp.json?.threadId;
  ok("B crea un grupo de chat de equipo", Boolean(threadB), grp.text);
  const tm = await ownerB.api(`/api/team-chat/threads/${threadB}/messages`, {
    method: "POST",
    body: JSON.stringify({ body: `mensaje ${SECRETO_B}` }),
  });
  const teamMsgB = tm.json?.message?.id;
  ok("B escribe en su chat de equipo", Boolean(teamMsgB), tm.text);
  const equipoB = (await ownerB.api("/api/settings/team")).json?.members ?? [];
  const memberB = equipoB.find((m) => m.email === cuentas.asesorB[0])?.id;
  ok("B tiene su asesora en el equipo", Boolean(memberB));

  // Un recurso propio de A para los ataques de "cruce" (colgarle algo de B).
  const telA = `52155${RUN}77`;
  await ownerA.api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN_A, from: telA, name: `Cliente A ${RUN}`, text: "hola A", waMessageId: `wamid.mo.a.${RUN}` }),
  });
  let convA = null;
  await hasta(async () => {
    convA = ((await ownerA.api("/api/conversations")).json?.conversations ?? []).find((c) => c.contact?.name === `Cliente A ${RUN}`) ?? null;
    return convA;
  });
  ok("A tiene su propia conversación", Boolean(convA));
  const contactA = convA?.contact?.id;
  const boardA = (await ownerA.api("/api/pipeline/board")).json ?? {};
  const leadA = (boardA.leads ?? [])[0]?.id;

  const idsB = [contactB, convB?.id, msgB?.id, assetB, leadB, stageB, tagB, knowledgeB, kbB, tplB, campaignB, bookingB, threadB, teamMsgB, memberB].filter(Boolean);

  console.log("\n== SSE: A escucha mientras B trabaja ==");
  const oidos = [ownerA, coordA, asesorA].map((c) => [c.nombre, escuchar(c)]);
  const oidoB = escuchar(ownerB);
  await sleep(600);
  await ownerB.api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN_B, from: telB, name: nombreB, text: `otra vez ${SECRETO_B}`, waMessageId: `wamid.mo.b.2.${RUN}` }),
  });
  await ownerB.api(`/api/team-chat/threads/${threadB}/messages`, { method: "POST", body: JSON.stringify({ body: `en vivo ${SECRETO_B}` }) });
  await ownerB.api(`/api/contacts/${contactB}/notes`, { method: "POST", body: JSON.stringify({ text: `nota ${SECRETO_B}` }) });
  await sleep(2500);
  const crudoB = await oidoB.cerrar();
  ok("el SSE de B sí recibe sus eventos (el detector no está ciego)", crudoB.includes(convB?.id ?? "∅"));
  for (const [nombre, oido] of oidos) {
    const crudo = await oido.cerrar();
    const fuga = idsB.filter((id) => crudo.includes(id));
    ok(`SSE de ${nombre}: ningún evento de B`, fuga.length === 0 && !crudo.includes(SECRETO_B), fuga.join(","));
  }

  console.log("\n== A ataca los recursos de B (API) ==");
  const antes = await huella(orgB);
  const J = (o) => JSON.stringify(o);
  /** [método, ruta, cuerpo] — cada una apunta a un recurso de B. */
  const ataques = [
    ["GET", `/api/contacts/${contactB}`],
    ["GET", `/api/contacts/${contactB}/timeline`],
    ["GET", `/api/contacts/${contactB}/assignments`],
    ["GET", `/api/contacts/${contactB}/participants`],
    ["GET", `/api/conversations/${convB?.id}/messages`],
    ["GET", `/api/media/${assetB}`],
    ["GET", `/api/knowledge/${knowledgeB}`],
    ["GET", `/api/knowledge/${knowledgeB}/file`],
    ["GET", `/api/campaigns/${campaignB}`],
    ["GET", `/api/campaigns/${campaignB}/recipients`],
    ["GET", `/api/team-chat/threads/${threadB}/messages`],
    ["GET", `/api/team-chat/messages/${teamMsgB}`],
    ["PATCH", `/api/contacts/${contactB}`, J({ name: "hackeado" })],
    ["POST", `/api/contacts/${contactB}/notes`, J({ text: "nota intrusa" })],
    ["PUT", `/api/contacts/${contactB}/tags`, J({ tagIds: [] })],
    ["POST", `/api/contacts/${contactB}/participants`, J({ userId: uid.asesorA })],
    ["DELETE", `/api/contacts/${contactB}/participants?userId=${uid.asesorB}`],
    ["POST", `/api/contacts/${contactB}/start-conversation`, J({})],
    ["PATCH", `/api/conversations/${convB?.id}`, J({ aiEnabled: false, markRead: true })],
    ["POST", `/api/conversations/${convB?.id}/messages`, J({ text: "mensaje intruso" })],
    ["POST", `/api/conversations/${convB?.id}/messages/knowledge`, J({ entryId: knowledgeB, mode: "text" })],
    ["POST", `/api/conversations/${convB?.id}/messages/template`, J({ templateId: tplB })],
    ["PATCH", `/api/pipeline/leads/${leadB}`, J({ position: 0 })],
    ["PATCH", `/api/pipeline/stages/${stageB}`, J({ name: "etapa intrusa" })],
    ["DELETE", `/api/pipeline/stages/${stageB}`],
    ["PATCH", `/api/contact-tags/${tagB}`, J({ name: "tag intruso" })],
    ["DELETE", `/api/contact-tags/${tagB}`],
    ["PATCH", `/api/knowledge/${knowledgeB}`, J({ title: "intruso" })],
    ["DELETE", `/api/knowledge/${knowledgeB}`],
    ["PATCH", `/api/kb/${kbB}`, J({ answer: "intruso" })],
    ["DELETE", `/api/kb/${kbB}`],
    ["PATCH", `/api/bookings/${bookingB}`, J({ action: "cancel" })],
    ["POST", `/api/campaigns/${campaignB}/send`, J({})],
    ["DELETE", `/api/campaigns/${campaignB}`],
    ["POST", `/api/team-chat/threads/${threadB}/messages`, J({ body: "intruso" })],
    ["POST", `/api/team-chat/threads/${threadB}/read`, J({})],
    ["PATCH", `/api/team-chat/messages/${teamMsgB}`, J({ body: "intruso" })],
    ["PUT", `/api/team-chat/messages/${teamMsgB}/reactions`, J({ emoji: "👍" })],
    ["DELETE", `/api/team-chat/messages/${teamMsgB}`],
    ["PATCH", `/api/team-chat/groups/${threadB}`, J({ name: "grupo intruso" })],
    ["DELETE", `/api/team-chat/groups/${threadB}`],
    ["PATCH", `/api/settings/team/${memberB}`, J({ role: "coordinador" })],
    ["DELETE", `/api/settings/team/${memberB}`],
  ];
  /** Cruces: un recurso de A al que se intenta colgar algo de B. */
  const cruces = [
    ["PUT", `/api/contacts/${contactA}/tags`, J({ tagIds: [tagB] })],
    ["POST", `/api/contacts/${contactA}/participants`, J({ userId: uid.ownerB })],
    ["POST", `/api/conversations/${convA?.id}/messages/template`, J({ templateId: tplB })],
    ["POST", `/api/conversations/${convA?.id}/messages/knowledge`, J({ entryId: knowledgeB, mode: "text" })],
    ["PATCH", `/api/pipeline/leads/${leadA}`, J({ stageId: stageB })],
    ["POST", "/api/bookings", J({ kind: "session", contactId: contactB, startUtc: new Date(inicio.getTime() + 3600000).toISOString() })],
    ["POST", "/api/campaigns", J({ name: "cruce", templateId: tplB, variables: [], audience: {} })],
    ["POST", "/api/team-chat/threads", J({ userId: uid.ownerB })],
    ["POST", "/api/team-chat/groups", J({ name: "cruce", memberIds: [uid.ownerB] })],
  ];

  for (const c of [ownerA, coordA, asesorA]) {
    for (const [method, ruta, body] of ataques) {
      const r = await c.api(ruta, { method, ...(body ? { body } : {}) });
      const filtra = idsB.some((id) => r.text.includes(id)) || r.text.includes(SECRETO_B);
      ok(`${c.nombre}: ${method} ${ruta.replace(/[a-z]+_[A-Za-z0-9_-]{8,}/g, "‹B›")} → ${r.status}`,
        (r.status === 404 || r.status === 403) && !filtra,
        filtra ? "¡el cuerpo trae datos de B!" : r.text.slice(0, 160));
    }
    for (const [method, ruta, body] of cruces) {
      const r = await c.api(ruta, { method, ...(body ? { body } : {}) });
      const filtra = r.text.includes(SECRETO_B);
      ok(`${c.nombre}: cruce ${method} ${ruta.replace(/[a-z]+_[A-Za-z0-9_-]{8,}/g, "‹id›")} → ${r.status}`,
        r.status >= 400 && r.status < 500 && !filtra, r.text.slice(0, 160));
    }
  }

  console.log("\n== A enumera: ningún listado trae nada de B ==");
  const listados = [
    "/api/contacts", "/api/conversations", "/api/pipeline/board", "/api/pipeline/stages",
    "/api/contact-tags", "/api/knowledge", "/api/kb", "/api/templates", "/api/campaigns",
    `/api/bookings?from=${new Date(Date.now() - 86400000).toISOString()}&to=${new Date(Date.now() + 30 * 86400000).toISOString()}`,
    "/api/bookings", "/api/team-chat/threads", "/api/team-chat/groups", "/api/team-chat/people",
    "/api/team-chat/unread", "/api/settings/team", "/api/assignments", "/api/lab/runs",
    "/api/contacts/export", "/api/analytics/sales", "/api/analytics/hygiene", "/api/analytics/ads",
    `/api/contacts?q=${encodeURIComponent(SECRETO_B)}`, `/api/conversations?q=${encodeURIComponent(SECRETO_B)}`,
  ];
  for (const c of [ownerA, coordA, asesorA]) {
    for (const ruta of listados) {
      const r = await c.api(ruta);
      const fuga = idsB.filter((id) => r.text.includes(id));
      ok(`${c.nombre}: GET ${ruta.split("?")[0]} sin datos de B (${r.status})`,
        fuga.length === 0 && !r.text.includes(SECRETO_B), fuga.join(","));
    }
  }

  const despues = await huella(orgB);
  const cambios = diferencias(antes, despues);
  ok("los datos de B quedaron idénticos tras todos los ataques", cambios.length === 0, cambios.join(", "));

  console.log("\n== Webhook: el número de B nunca escribe en A ==");
  const antesA = await huella(orgA);
  await ownerB.api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN_B, from: telA, name: `Cruce ${RUN}`, text: SECRETO_B, waMessageId: `wamid.mo.cruce.${RUN}` }),
  });
  await sleep(1500);
  const despuesA = await huella(orgA);
  ok("un entrante al número de B (mismo teléfono que un cliente de A) no toca A", diferencias(antesA, despuesA).length === 0,
    diferencias(antesA, despuesA).join(", "));
  const [enB] = await sql`select count(*)::int as n from "message" where organization_id = ${orgB} and wa_message_id = ${`wamid.mo.cruce.${RUN}`}`;
  ok("…y sí queda en B", enB.n === 1);

  console.log("\n== H2: el cerebro externo opera sobre la organización de SU llave ==");
  const bot = async (key, ruta) => {
    const res = await fetch(`${BASE}${ruta}`, { headers: { "x-api-key": key } });
    return { status: res.status, text: await res.text() };
  };
  let llaveB = null;
  try {
    const salida = execFileSync("node", ["--env-file=.env", "scripts/bot-key.mjs", "create", "--org", orgB, "--name", `e2e ${RUN}`], { encoding: "utf8" });
    llaveB = /^vbk_[A-Za-z0-9_-]+$/m.exec(salida)?.[0] ?? null;
  } catch (err) {
    console.log(`  (no se pudo crear la llave de B: ${String(err?.message ?? err).split("\n")[0]})`);
  }
  ok("se crea una llave del cerebro externo para B (script de operador)", Boolean(llaveB));
  if (llaveB) {
    const propia = await bot(llaveB, `/api/bot/context?conversationId=${convB?.id}`);
    ok("con la llave de B, B ve su conversación", propia.status === 200, `status=${propia.status}`);
    const ajena = await bot(llaveB, `/api/bot/context?conversationId=${convA?.id}`);
    ok("con la llave de B, la conversación de A es 404", ajena.status === 404, `status=${ajena.status}`);
    execFileSync("node", ["--env-file=.env", "scripts/bot-key.mjs", "revoke", "--org", orgB], { encoding: "utf8" });
    const revocada = await bot(llaveB, `/api/bot/context?conversationId=${convB?.id}`);
    ok("una llave revocada responde 401", revocada.status === 401, `status=${revocada.status}`);
  }
  if (process.env.BOT_API_KEY) {
    const env = await bot(process.env.BOT_API_KEY, `/api/bot/context?conversationId=${convB?.id}`);
    ok("la BOT_API_KEY de la plataforma jamás ve conversaciones de B", env.status === 404 || env.status === 401, `status=${env.status}`);
  }
  const sinLlave = await bot("vbk_" + "x".repeat(40), `/api/bot/context?conversationId=${convB?.id}`);
  ok("una llave inventada responde 401", sinLlave.status === 401, `status=${sinLlave.status}`);

  console.log("\n== H4: la organización de la sesión es determinista ==");
  // Una membresía extra (más nueva) en B para el asesor A: su sesión sigue en A.
  const extra = nid("mem");
  await sql`insert into "member" (id, organization_id, user_id, role, created_at) values (${extra}, ${orgB}, ${uid.asesorA}, 'asesor', now() + interval '1 minute')`;
  try {
    const asesorA2 = cliente("asesor A (nueva sesión)");
    await entrar(asesorA2, cuentas.asesorA[0], PASSWORD);
    const marcaVista = (await asesorA2.api("/api/settings/branding")).json?.branding?.name;
    ok("con dos membresías, el asesor A sigue en A (su primera)", marcaVista === MARCA_A, `ve «${marcaVista}»`);
    const convs = (await asesorA2.api("/api/conversations")).text;
    ok("…y no ve nada de B", !idsB.some((id) => convs.includes(id)));
  } finally {
    await sql`delete from "member" where id = ${extra}`;
  }

  console.log("\n== H7: el token secreto del webhook es de la plataforma ==");
  const token = process.env.META_WEBHOOK_VERIFY_TOKEN;
  const whB = await ownerB.api("/api/settings/webhook");
  ok("el Propietario de B NO recibe el token del webhook", whB.status === 200 && !whB.text.includes(token), whB.text.slice(0, 200));
  ok("…y se le dice que lo administra la plataforma", whB.json?.managedByPlatform === true, whB.text.slice(0, 200));
  const whA = await ownerA.api("/api/settings/webhook");
  if (esPlataformaA) {
    ok("el Propietario de la organización de plataforma sí lo recibe", whA.text.includes(token));
  } else {
    ok("sin PLATFORM_ORG_ID nadie recibe el token, con aviso de configuración", !whA.text.includes(token) && whA.json?.platformConfigMissing === true, whA.text.slice(0, 200));
  }

  console.log("\n== H11: sin sesión se ve la marca neutra de la plataforma ==");
  const login = await anon.api("/login");
  ok("el login no muestra la marca de A", login.status < 500 && !login.text.includes(MARCA_A), `status=${login.status}`);
  ok("…ni la de B", !login.text.includes(`Marca B ${RUN}`.slice(0, 30)));
  const marcaAnon = await anon.api("/api/settings/branding");
  ok("GET /api/settings/branding sin sesión no trae marca de un cliente",
    !marcaAnon.text.includes(MARCA_A) && !marcaAnon.text.includes(`Marca B ${RUN}`.slice(0, 30)), marcaAnon.text.slice(0, 120));
  const marcaConSesion = await ownerA.api("/api/settings/branding");
  ok("con sesión, A ve SU marca", marcaConSesion.json?.branding?.name === MARCA_A);

  console.log("\n== H13: el alta de miembros no revela correos de otras organizaciones ==");
  const altaAjena = await ownerA.api("/api/settings/team", {
    method: "POST",
    body: JSON.stringify({ name: "x", email: cuentas.ownerB[0], password: PASSWORD, role: "asesor" }),
  });
  ok("correo de otra organización → 422 genérico", altaAjena.status === 422 && !/existe/i.test(altaAjena.text), `${altaAjena.status} ${altaAjena.text}`);
  const altaPropia = await ownerA.api("/api/settings/team", {
    method: "POST",
    body: JSON.stringify({ name: "x", email: cuentas.asesorA[0], password: PASSWORD, role: "asesor" }),
  });
  ok("correo de alguien de MI equipo → 409 «ya está en tu equipo»", altaPropia.status === 409, `${altaPropia.status} ${altaPropia.text}`);
  const altaInexistente = await ownerA.api("/api/settings/team", {
    method: "POST",
    body: JSON.stringify({ name: "x", email: `nadie.${RUN}@vocero.test`, password: "corta", role: "asesor" }),
  });
  ok("la validación sigue siendo 422 normal", altaInexistente.status === 422);

  console.log(`\n${checks - failures}/${checks} checks OK`);
  if (failures > 0) {
    console.log("Fallaron:\n" + fallas.map((f) => `  · ${f}`).join("\n"));
  }
}

try {
  await main();
} catch (err) {
  failures++;
  console.error("error no controlado:", err);
} finally {
  await sql.end();
}
process.exit(failures > 0 ? 1 : 0);
