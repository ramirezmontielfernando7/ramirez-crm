/**
 * Self-test E2E — 026 Participantes en chats de WhatsApp y menciones de
 * chats de cliente en el chat de equipo. Guion: tests/e2e/us-participantes-menciones.md
 *
 * Conduce la app REAL (Postgres de verdad) con varias personas a la vez:
 *  - Participantes: solo quien reparte los agrega/quita (asesor = 403);
 *    idempotente; el asignado y alguien de fuera no entran. El participante
 *    VE el chat, lo lee, responde y recibe su SSE; al quitarlo, 404. La
 *    asignación principal no cambia. Queda en la línea de tiempo.
 *  - Aviso de handoff: al asignado, Coordinadora y Propietario; el
 *    participante NO lo recibe (aunque sí el cambio de estado del chat).
 *    Chat sin asignar: ningún asesor lo recibe.
 *  - Menciones: el autor solo menciona chats que ve (422 si no); quien lee
 *    sin acceso recibe { accessible: false } sin id ni nombre, ni en el texto
 *    ni en la vista previa ni en el SSE; quien tiene acceso navega al chat.
 *  - Navegador: la pastilla de la mención abre el chat en la Bandeja; sin
 *    acceso se ve "chat sin acceso"; el toast de handoff le aparece al asignado.
 *
 * Uso: app viva con WA_MOCK_ENABLED=true (next dev), BOT_API_KEY y BD migrada:
 *   node --env-file=.env scripts/e2e-participantes-menciones.mjs
 * Reinicia el servidor antes (límite de intentos de login).
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const BOT_KEY = process.env.BOT_API_KEY ?? "";
const PASSWORD = "password-e2e-part-123";
const OWNER = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
const PN = "PN-E2E-PART";
const S = Math.random().toString(36).slice(2, 6);

let failures = 0;
let checks = 0;
function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 8000, paso = 150) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}
const aparece = (locator, ms = 8000) =>
  locator.waitFor({ state: "visible", timeout: ms }).then(() => true).catch(() => false);

function cliente(nombre) {
  let cookie = "";
  async function api(path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
      redirect: "manual",
      ...opts,
      headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) },
    });
    const sc = res.headers.getSetCookie?.() ?? [];
    if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
    let json = null;
    try {
      json = await res.clone().json();
    } catch {}
    return { res, json };
  }
  return { nombre, api, cookie: () => cookie };
}

async function entrar(c, email, password = PASSWORD, name) {
  let r = await c.api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  if (!r.res.ok && name) r = await c.api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name }) });
  return r.res.ok;
}

function escuchar(c) {
  const ctl = new AbortController();
  const eventos = [];
  (async () => {
    try {
      const res = await fetch(`${BASE}/api/events`, { headers: { cookie: c.cookie() }, signal: ctl.signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) !== -1) {
          const bloque = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const type = /^event: (.+)$/m.exec(bloque)?.[1];
          const data = /^data: (.+)$/m.exec(bloque)?.[1];
          if (type && data) eventos.push({ type, data: JSON.parse(data), raw: bloque });
        }
      }
    } catch {
      /* cerrado */
    }
  })();
  return { eventos, de: (type) => eventos.filter((e) => e.type === type), cerrar: () => ctl.abort() };
}

const inbound = (owner, from, name, text) =>
  owner.api("/api/dev/wa-mock/inbound", {
    method: "POST",
    body: JSON.stringify({ phoneNumberId: PN, from, name, text, waMessageId: `wamid.part.${S}.${from}.${Math.random()}` }),
  });

async function main() {
  if (BOT_KEY.length < 16) {
    console.error("BOT_API_KEY ausente o corta: el handoff se provoca por /api/bot/handoff.");
    process.exit(1);
  }
  console.log("== Setup ==");
  const owner = cliente("propietario");
  ok("propietario entra", await entrar(owner, OWNER.email, OWNER.password, OWNER.name));
  const conn = await owner.api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-PART", phoneNumberId: PN, token: "tok-part" }),
  });
  ok("WhatsApp conectado (wa-mock)", conn.res.ok, `status=${conn.res.status}`);
  const equipo = {
    coord: ["coord.part@vocero.test", "Coordinadora Part", "coordinador"],
    a: ["asesor.a.part@vocero.test", "Asesora A Part", "asesor"],
    b: ["asesor.b.part@vocero.test", "Asesor B Part", "asesor"],
    c: ["asesor.c.part@vocero.test", "Asesor C Part", "asesor"],
  };
  for (const [email, name, role] of Object.values(equipo)) {
    await owner.api("/api/settings/team", { method: "POST", body: JSON.stringify({ name, email, password: PASSWORD, role }) });
  }
  const miembros = (await owner.api("/api/settings/team")).json?.members ?? [];
  const idDe = (email) => miembros.find((m) => m.email === email)?.userId;
  const ID = { coord: idDe(equipo.coord[0]), A: idDe(equipo.a[0]), B: idDe(equipo.b[0]), C: idDe(equipo.c[0]) };
  const [coord, A, B, C] = ["coord", "a", "b", "c"].map((k) => cliente(k));
  for (const [c, [email]] of [[coord, equipo.coord], [A, equipo.a], [B, equipo.b], [C, equipo.c]]) {
    ok(`${c.nombre} entra`, await entrar(c, email));
  }

  const telX = `5215588${Math.floor(100000 + Math.random() * 899999)}`;
  const telY = `5215599${Math.floor(100000 + Math.random() * 899999)}`;
  const nombreX = `Clínica X ${S}`;
  const nombreY = `Dental Y ${S}`;
  await inbound(owner, telX, nombreX, "Hola, quiero una cita");
  await inbound(owner, telY, nombreY, "Buenas tardes");
  let convs = [];
  await hasta(async () => {
    convs = (await owner.api("/api/conversations")).json?.conversations ?? [];
    return convs.some((c) => c.contact.name === nombreX) && convs.some((c) => c.contact.name === nombreY);
  });
  const X = convs.find((c) => c.contact.name === nombreX);
  const Y = convs.find((c) => c.contact.name === nombreY);
  ok("llegan los dos chats de cliente", !!X && !!Y);
  const asg = await owner.api("/api/assignments", { method: "POST", body: JSON.stringify({ contactIds: [X.contact.id], userId: ID.A }) });
  ok("el chat X se asigna a A", asg.res.ok, `status=${asg.res.status}`);

  const sse = { owner: escuchar(owner), coord: escuchar(coord), A: escuchar(A), B: escuchar(B), C: escuchar(C) };
  await sleep(600);

  console.log("\n== Participantes ==");
  ok("B no ve X antes (404)", (await B.api(`/api/conversations/${X.id}/messages`)).res.status === 404);
  const addPath = `/api/contacts/${X.contact.id}/participants`;
  ok("un asesor no agrega participantes (403)", (await A.api(addPath, { method: "POST", body: JSON.stringify({ userId: ID.B }) })).res.status === 403);
  const alta = await coord.api(addPath, { method: "POST", body: JSON.stringify({ userId: ID.B }) });
  ok("la coordinadora suma a B como participante", alta.res.status === 201, `status=${alta.res.status}`);
  ok("otra vez: idempotente (200)", (await coord.api(addPath, { method: "POST", body: JSON.stringify({ userId: ID.B }) })).res.status === 200);
  ok("el asignado no entra como participante (409)", (await coord.api(addPath, { method: "POST", body: JSON.stringify({ userId: ID.A }) })).res.status === 409);
  ok("alguien de fuera → 422", (await coord.api(addPath, { method: "POST", body: JSON.stringify({ userId: "usr_de_otro_lado" }) })).res.status === 422);
  ok("B recibe participants.changed", await hasta(() => sse.B.de("participants.changed").length > 0));
  ok("C no", sse.C.de("participants.changed").length === 0);

  const listaB = (await B.api("/api/conversations")).json?.conversations ?? [];
  ok("B ya ve X en su Bandeja", listaB.some((c) => c.id === X.id));
  ok("B no ve Y (ni asignado ni participante)", !listaB.some((c) => c.id === Y.id));
  ok("B lee los mensajes de X", (await B.api(`/api/conversations/${X.id}/messages`)).res.ok);
  const resp = await B.api(`/api/conversations/${X.id}/messages`, { method: "POST", body: JSON.stringify({ text: `Te atiende B ${S}` }) });
  ok("B responde en X", resp.res.status === 201 || resp.res.ok, `status=${resp.res.status}`);
  const lista2 = (await owner.api("/api/conversations")).json?.conversations ?? [];
  ok("la asignación principal sigue siendo A", lista2.find((c) => c.id === X.id)?.assignee?.id === ID.A);
  const part = (await A.api(addPath)).json?.participants ?? [];
  ok("A (asignada) ve la lista de participantes", part.some((p) => p.userId === ID.B));
  ok("C no puede leer la lista (404)", (await C.api(addPath)).res.status === 404);

  const nB = sse.B.de("message.new").length;
  await inbound(owner, telX, nombreX, `¿Siguen ahí? ${S}`);
  ok("B recibe el mensaje nuevo de X por SSE", await hasta(() => sse.B.de("message.new").length > nB));
  await sleep(300);
  ok("C no recibe nada de X", !sse.C.eventos.some((e) => e.data?.conversationId === X.id));
  const tl = (await B.api(`/api/contacts/${X.contact.id}/timeline`)).json?.items ?? [];
  ok("la línea de tiempo registra la entrada de B", tl.some((i) => i.kind === "participant_added"));

  console.log("\n== Aviso de handoff ==");
  await owner.api(`/api/conversations/${X.id}`, { method: "PATCH", body: JSON.stringify({ reactivate: true }) });
  await owner.api(`/api/conversations/${Y.id}`, { method: "PATCH", body: JSON.stringify({ reactivate: true }) });
  await sleep(300);
  const cuenta = () => Object.fromEntries(Object.entries(sse).map(([k, s]) => [k, s.de("handoff.requested").length]));
  const antes = cuenta();
  const nUpdB = sse.B.de("conversation.updated").length;
  const h = await fetch(`${BASE}/api/bot/handoff`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": BOT_KEY },
    body: JSON.stringify({ conversationId: X.id, reason: "cliente" }),
  });
  ok("handoff en X (cerebro externo)", h.ok, `status=${h.status}`);
  ok("A (asignada) recibe el aviso", await hasta(() => sse.A.de("handoff.requested").length > antes.A));
  ok("la coordinadora lo recibe", await hasta(() => sse.coord.de("handoff.requested").length > antes.coord));
  ok("el propietario lo recibe", await hasta(() => sse.owner.de("handoff.requested").length > antes.owner));
  ok("B (participante) recibe el cambio de estado del chat", await hasta(() => sse.B.de("conversation.updated").length > nUpdB));
  await sleep(300);
  ok("…pero NO el aviso de handoff", sse.B.de("handoff.requested").length === antes.B);
  ok("C tampoco", sse.C.de("handoff.requested").length === antes.C);
  const antesY = cuenta();
  await fetch(`${BASE}/api/bot/handoff`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": BOT_KEY },
    body: JSON.stringify({ conversationId: Y.id, reason: "cliente" }),
  });
  ok("chat sin asignar: la coordinadora recibe el aviso", await hasta(() => sse.coord.de("handoff.requested").length > antesY.coord));
  await sleep(300);
  ok("…y ningún asesor", sse.A.de("handoff.requested").length === antesY.A && sse.B.de("handoff.requested").length === antesY.B);

  console.log("\n== Menciones ==");
  const grupo = await owner.api("/api/team-chat/groups", {
    method: "POST",
    body: JSON.stringify({ name: `Menciones ${S}`, memberIds: [ID.A, ID.B, ID.C] }),
  });
  const G = grupo.json?.threadId;
  ok("grupo A·B·C", grupo.res.status === 201);
  const tokenX = `@[chat:${X.id}]`;
  const tokenY = `@[chat:${Y.id}]`;
  ok(
    "A no puede mencionar un chat que no ve (Y) → 422",
    (await A.api(`/api/team-chat/threads/${G}/messages`, { method: "POST", body: JSON.stringify({ body: `mira ${tokenY}` }) })).res.status === 422
  );
  const nC = sse.C.de("team.message").length;
  const men = await A.api(`/api/team-chat/threads/${G}/messages`, { method: "POST", body: JSON.stringify({ body: `Revisen ${tokenX} por favor` }) });
  ok("A menciona X (lo ve)", men.res.status === 201);
  const mid = men.json?.message?.id;
  ok("A ve la mención resuelta", men.json?.message?.mentions?.[0]?.accessible === true && men.json?.message?.mentions?.[0]?.label === nombreX);
  ok("C recibe el mensaje por SSE", await hasta(() => sse.C.de("team.message").length > nC));
  const eventoC = sse.C.de("team.message").at(-1);
  ok("el evento SSE no trae ni el id ni el nombre del chat", !eventoC.raw.includes(X.id) && !eventoC.raw.includes(nombreX) && eventoC.data.message.needsResolve === true);
  const vistaC = (await C.api(`/api/team-chat/messages/${mid}`)).json?.message;
  ok("C (sin acceso a X) ve la mención sin acceso", vistaC?.mentions?.[0]?.accessible === false);
  ok("…y nada del chat: ni id ni nombre ni contacto", !JSON.stringify(vistaC).includes(X.id) && !JSON.stringify(vistaC).includes(nombreX) && !JSON.stringify(vistaC).includes(X.contact.id));
  const vistaB = (await B.api(`/api/team-chat/messages/${mid}`)).json?.message;
  ok("B (participante de X) sí la ve resuelta", vistaB?.mentions?.[0]?.accessible === true && vistaB?.mentions?.[0]?.contactId === X.contact.id);
  const histC = (await C.api(`/api/team-chat/threads/${G}/messages`)).json?.messages ?? [];
  ok("en el historial de C tampoco hay rastro de X", !JSON.stringify(histC).includes(X.id) && !JSON.stringify(histC).includes(nombreX));
  const listaC = (await C.api("/api/team-chat/threads")).json?.threads ?? [];
  ok("la vista previa de la lista no lleva el id", !JSON.stringify(listaC).includes(X.id));
  ok("C sigue sin poder abrir X (404)", (await C.api(`/api/conversations/${X.id}/messages`)).res.status === 404);

  await navegador({ A, B, C, G, nombreX, X, sse });

  console.log("\n== Quitar participante ==");
  const baja = await coord.api(`${addPath}?userId=${ID.B}`, { method: "DELETE" });
  ok("la coordinadora quita a B", baja.res.ok && baja.json?.removed === true);
  ok("B ya no ve X (404)", (await B.api(`/api/conversations/${X.id}/messages`)).res.status === 404);
  const vistaB2 = (await B.api(`/api/team-chat/messages/${mid}`)).json?.message;
  ok("y la mención de X ahora le sale sin acceso", vistaB2?.mentions?.[0]?.accessible === false);
  const tl2 = (await A.api(`/api/contacts/${X.contact.id}/timeline`)).json?.items ?? [];
  ok("la línea de tiempo registra la salida", tl2.some((i) => i.kind === "participant_removed"));

  for (const s of Object.values(sse)) s.cerrar();
  console.log(`\n${checks - failures}/${checks} checks OK`);
  process.exit(failures ? 1 : 0);
}

async function navegador({ A, B, C, G, nombreX, X }) {
  console.log("\n== Navegador ==");
  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
  );
  const abrir = async (c) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
    await ctx.addCookies(
      c.cookie().split("; ").map((kv) => {
        const i = kv.indexOf("=");
        return { name: kv.slice(0, i), value: kv.slice(i + 1), url: BASE };
      })
    );
    return ctx.newPage();
  };
  try {
    const pb = await abrir(B);
    const pc = await abrir(C);
    await pb.goto(`${BASE}/chat?t=${G}`);
    await pc.goto(`${BASE}/chat?t=${G}`);
    const chip = pb.getByRole("button", { name: `@${nombreX}` }).first();
    ok("B ve la mención como pastilla con el nombre", await aparece(chip, 15000));
    ok("C la ve como «chat sin acceso»", await aparece(pc.getByText("@ chat sin acceso").first(), 15000));
    ok("…y en la página de C no aparece el nombre del cliente", !(await pc.content()).includes(nombreX));
    if (process.env.CAPTURAS_DIR) {
      await pb.screenshot({ path: `${process.env.CAPTURAS_DIR}/mencion-con-acceso.png` });
      await pc.screenshot({ path: `${process.env.CAPTURAS_DIR}/mencion-sin-acceso.png` });
    }
    await chip.click();
    ok("al presionarla navega al chat en la Bandeja", await hasta(async () => pb.url().includes(`/inbox?contact=${X.contact.id}`), 10000));
    ok("…y abre ese chat", await aparece(pb.getByRole("heading", { name: nombreX }).or(pb.locator("header").getByText(nombreX)).first(), 15000));

    // Toast de handoff para la asignada (A), en vivo.
    const pa = await abrir(A);
    await pa.goto(`${BASE}/inbox`);
    await pa.waitForTimeout(2500);
    await A.api(`/api/conversations/${X.id}`, { method: "PATCH", body: JSON.stringify({ reactivate: true }) });
    await fetch(`${BASE}/api/bot/handoff`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": BOT_KEY },
      body: JSON.stringify({ conversationId: X.id, reason: "cliente" }),
    });
    ok("a la asignada le aparece el aviso de atención humana", await aparece(pa.getByText(`Atención humana: ${nombreX}`), 10000));
    if (process.env.CAPTURAS_DIR) await pa.screenshot({ path: `${process.env.CAPTURAS_DIR}/aviso-handoff.png` });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
