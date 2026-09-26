/**
 * Self-test E2E — 025 Chat de equipo. Guion: tests/e2e/us-chat-equipo.md
 *
 * Conduce la app REAL (Postgres de verdad) con varias personas a la vez:
 *  - Avisos: todos leen y reaccionan; publican Propietario y Coordinador.
 *  - Directos: el no participante y el Coordinador (que ve todos los chats de
 *    clientes) reciben 404 y NINGÚN evento SSE; el Propietario con la
 *    supervisión encendida los ve en solo lectura; apagada, 404 y nada por SSE.
 *  - Aviso de supervisión solo con los dos ajustes encendidos.
 *  - No leídos por persona e hilo; editar/borrar solo el autor; paginación
 *    con before=; largo máximo; adjuntos (SVG/HTML bloqueados, cabeceras,
 *    404 al ajeno); grupos con la delegación al Coordinador; Conocimientos.
 *  - Un usuario removido de la organización deja de recibir SSE y de leer.
 *  - Navegador: dos personas en vivo (mensaje sin recargar, globo del menú,
 *    emoji desde frimousse, reacción).
 *
 * Uso: app viva con WA_MOCK_ENABLED=true (next dev) y BD migrada:
 *   node --env-file=.env scripts/e2e-chat-equipo.mjs
 * Reinicia el servidor antes de correrlo (límite de intentos de login).
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PASSWORD = "password-e2e-chat-123";
const OWNER = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };
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

function cliente(nombre) {
  let cookie = "";
  async function api(path, opts = {}) {
    const isForm = opts.body instanceof FormData;
    const res = await fetch(`${BASE}${path}`, {
      redirect: "manual",
      ...opts,
      headers: {
        ...(isForm ? {} : { "content-type": "application/json" }),
        origin: BASE,
        ...(cookie ? { cookie } : {}),
        ...(opts.headers ?? {}),
      },
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
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
  if (!r.res.ok && name) {
    r = await c.api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name }) });
  }
  return r.res.ok;
}

/** Abre /api/events como esta persona y junta lo que llega. */
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
  return {
    eventos,
    del: (threadId) => eventos.filter((e) => e.type.startsWith("team.") && e.data.threadId === threadId),
    cerrar: () => ctl.abort(),
  };
}

const post = (c, t, body) =>
  c.api(`/api/team-chat/threads/${t}/messages`, { method: "POST", body: JSON.stringify({ body }) });
const lista = async (c) => (await c.api("/api/team-chat/threads")).json;
const unread = async (c) => (await c.api("/api/team-chat/unread")).json?.unread;

async function main() {
  console.log("== Setup: propietario y equipo ==");
  const owner = cliente("propietario");
  ok("propietario entra", await entrar(owner, OWNER.email, OWNER.password, OWNER.name));
  // Supervisión a su default y la delegación apagada (re-corridas).
  await owner.api("/api/team-chat/settings", {
    method: "PUT",
    body: JSON.stringify({ ownerOversight: true, showOversightNotice: false, coordinatorsCanCreateGroups: false }),
  });
  const equipo = {
    coord: ["coord.chat@vocero.test", "Coordinadora Chat", "coordinador"],
    a: ["asesor.a.chat@vocero.test", "Asesora A Chat", "asesor"],
    b: ["asesor.b.chat@vocero.test", "Asesor B Chat", "asesor"],
    c: [`asesor.c.${S}@vocero.test`, `Asesor C ${S}`, "asesor"],
  };
  for (const [email, name, role] of Object.values(equipo)) {
    const alta = await owner.api("/api/settings/team", {
      method: "POST",
      body: JSON.stringify({ name, email, password: PASSWORD, role }),
    });
    ok(`alta de ${name}`, alta.res.status === 201 || alta.res.status === 409, `status=${alta.res.status}`);
  }
  const miembros = (await owner.api("/api/settings/team")).json?.members ?? [];
  const idDe = (email) => miembros.find((m) => m.email === email)?.userId;
  const memberIdDe = (email) => miembros.find((m) => m.email === email)?.id;
  const [coord, A, B, C] = ["coord", "a", "b", "c"].map((k) => cliente(k));
  for (const [c, [email]] of [[coord, equipo.coord], [A, equipo.a], [B, equipo.b], [C, equipo.c]]) {
    ok(`${c.nombre} entra`, await entrar(c, email));
  }
  const ID = { A: idDe(equipo.a[0]), B: idDe(equipo.b[0]), C: idDe(equipo.c[0]), coord: idDe(equipo.coord[0]) };

  const sse = { owner: escuchar(owner), coord: escuchar(coord), A: escuchar(A), B: escuchar(B), C: escuchar(C) };
  await sleep(600);

  console.log("\n== Avisos ==");
  const avisos = (await lista(A)).threads.find((t) => t.kind === "announcements");
  ok("el canal de avisos existe y todos lo ven", !!avisos && (await lista(C)).threads.some((t) => t.id === avisos.id));
  ok("el asesor no publica en avisos (403)", (await post(A, avisos.id, "hola")).res.status === 403);
  const aviso = await post(coord, avisos.id, `Aviso de la coordinadora ${S}`);
  ok("la coordinadora publica en avisos", aviso.res.status === 201, `status=${aviso.res.status}`);
  const avisoId = aviso.json?.message?.id;
  const reac = await A.api(`/api/team-chat/messages/${avisoId}/reactions`, { method: "PUT", body: JSON.stringify({ emoji: "👍" }) });
  ok("el asesor reacciona en avisos", reac.res.ok && reac.json?.message?.reactions?.[0]?.userIds?.includes(ID.A));
  ok(
    "a todos les llega el aviso por SSE",
    await hasta(() => ["owner", "A", "B", "C"].every((k) => sse[k].del(avisos.id).length > 0))
  );

  console.log("\n== Directo A ↔ B ==");
  const dir = await A.api("/api/team-chat/threads", { method: "POST", body: JSON.stringify({ userId: ID.B }) });
  ok("A abre un directo con B", dir.res.status === 201);
  const D = dir.json?.threadId;
  const dir2 = await B.api("/api/team-chat/threads", { method: "POST", body: JSON.stringify({ userId: ID.A }) });
  ok("B abre el mismo directo (uno por par)", dir2.json?.threadId === D);
  const antesB = await unread(B);
  const m1 = await post(A, D, `Hola B, secreto ${S}`);
  ok("A escribe en el directo", m1.res.status === 201);
  ok("B lo recibe en tiempo real", await hasta(() => sse.B.del(D).some((e) => e.data.change === "new")));
  ok("el propietario (supervisión encendida) también", await hasta(() => sse.owner.del(D).length > 0));
  await sleep(400);
  ok("C (no participa) NO recibe nada del directo", sse.C.del(D).length === 0);
  ok("la coordinadora (ve todos los chats de clientes) NO recibe nada", sse.coord.del(D).length === 0);
  ok(
    "ningún evento trae la audiencia al cliente",
    Object.values(sse).every((s) => s.eventos.every((e) => !e.raw.includes("audience")))
  );
  ok("C recibe 404 al leer el directo", (await C.api(`/api/team-chat/threads/${D}/messages`)).res.status === 404);
  ok("la coordinadora recibe 404", (await coord.api(`/api/team-chat/threads/${D}/messages`)).res.status === 404);
  ok("C no puede escribir (404)", (await post(C, D, "intruso")).res.status === 404);

  const vistaOwner = await owner.api(`/api/team-chat/threads/${D}/messages`);
  ok("el propietario lo ve como supervisor", vistaOwner.json?.relation === "oversight" && vistaOwner.json?.canPost === false);
  ok("…y no escribe (403)", (await post(owner, D, "hola")).res.status === 403);
  ok(
    "…ni reacciona (403)",
    (await owner.api(`/api/team-chat/messages/${m1.json?.message?.id}/reactions`, { method: "PUT", body: JSON.stringify({ emoji: "👍" }) })).res
      .status === 403
  );
  ok("…ni edita (403)", (await owner.api(`/api/team-chat/messages/${m1.json?.message?.id}`, { method: "PATCH", body: JSON.stringify({ body: "x" }) })).res.status === 403);
  const listaOwner = await lista(owner);
  ok(
    "en su lista el directo va como supervisión y no suma a su badge",
    listaOwner.overseeing && listaOwner.threads.find((t) => t.id === D)?.relation === "oversight" && listaOwner.threads.find((t) => t.id === D)?.unread === 0
  );

  console.log("\n== No leídos ==");
  ok("a B le sube su contador", (await unread(B)) === antesB + 1, `antes=${antesB} ahora=${await unread(B)}`);
  ok("a A no le cuenta su propio mensaje", (await lista(A)).threads.find((t) => t.id === D)?.unread === 0);
  await B.api(`/api/team-chat/threads/${D}/read`, { method: "POST" });
  ok("B lee y su contador baja", (await lista(B)).threads.find((t) => t.id === D)?.unread === 0);
  const marcaOwner = await owner.api(`/api/team-chat/threads/${D}/read`, { method: "POST" });
  ok("la supervisión no marca leído", marcaOwner.json?.marked === false);

  console.log("\n== Editar y borrar ==");
  const mid = m1.json?.message?.id;
  ok("B no edita el mensaje de A (403)", (await B.api(`/api/team-chat/messages/${mid}`, { method: "PATCH", body: JSON.stringify({ body: "x" }) })).res.status === 403);
  ok("B no lo borra (403)", (await B.api(`/api/team-chat/messages/${mid}`, { method: "DELETE" })).res.status === 403);
  const ed = await A.api(`/api/team-chat/messages/${mid}`, { method: "PATCH", body: JSON.stringify({ body: `Hola B (editado) ${S}` }) });
  ok("A edita el suyo", ed.res.ok && !!ed.json?.message?.editedAt);
  ok("B ve la edición en vivo", await hasta(() => sse.B.del(D).some((e) => e.data.change === "updated")));
  const del = await A.api(`/api/team-chat/messages/${mid}`, { method: "DELETE" });
  ok("A lo borra (suave)", del.res.ok && del.json?.message?.deleted === true && del.json?.message?.body === "");
  const tras = (await B.api(`/api/team-chat/threads/${D}/messages`)).json?.messages ?? [];
  ok("queda como eliminado, sin texto", tras.some((m) => m.id === mid && m.deleted && !m.body));
  ok("no se edita lo borrado (409)", (await A.api(`/api/team-chat/messages/${mid}`, { method: "PATCH", body: JSON.stringify({ body: "y" }) })).res.status === 409);

  console.log("\n== Historial y validación ==");
  for (let i = 0; i < 55; i++) await post(B, D, `mensaje ${i}`);
  const p1 = (await A.api(`/api/team-chat/threads/${D}/messages?limit=50`)).json;
  ok("página de 50 con más atrás", p1?.messages?.length === 50 && p1?.hasMore === true);
  const p2 = (await A.api(`/api/team-chat/threads/${D}/messages?limit=50&before=${p1.messages[0].id}`)).json;
  ok("before= trae lo anterior sin repetir", p2?.messages?.length >= 5 && !p2.messages.some((m) => p1.messages.some((x) => x.id === m.id)));
  ok("limit fuera de rango → 422", (await A.api(`/api/team-chat/threads/${D}/messages?limit=5000`)).res.status === 422);
  ok("un mensaje de más de 4000 caracteres → 422", (await post(A, D, "x".repeat(4001))).res.status === 422);
  ok("un mensaje vacío → 422", (await post(A, D, "   ")).res.status === 422);

  console.log("\n== Adjuntos ==");
  const subir = (c, name, type, content) => {
    const form = new FormData();
    form.set("body", "");
    form.set("file", new Blob([content], { type }), name);
    return c.api(`/api/team-chat/threads/${D}/messages`, { method: "POST", body: form });
  };
  ok("SVG → 415", (await subir(A, "logo.svg", "image/svg+xml", "<svg/>")).res.status === 415);
  ok("HTML → 415", (await subir(A, "pagina.html", "text/html", "<h1>x</h1>")).res.status === 415);
  ok("HTML disfrazado por extensión → 415", (await subir(A, "truco.htm", "text/plain", "<script>")).res.status === 415);
  const pdf = await subir(A, "cotizacion.pdf", "application/pdf", "%PDF-1.4 prueba");
  ok("un PDF se sube", pdf.res.status === 201 && !!pdf.json?.message?.attachment);
  const url = pdf.json?.message?.attachment?.url;
  const bajaB = await fetch(`${BASE}${url}`, { headers: { cookie: B.cookie() } });
  ok(
    "B lo descarga como attachment con nosniff",
    bajaB.ok &&
      /^attachment;/.test(bajaB.headers.get("content-disposition") ?? "") &&
      bajaB.headers.get("x-content-type-options") === "nosniff" &&
      bajaB.headers.get("content-type") === "application/octet-stream"
  );
  ok("C (no participa) → 404", (await fetch(`${BASE}${url}`, { headers: { cookie: C.cookie() } })).status === 404);
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );
  const png = await subir(A, "foto.png", "image/png", PNG);
  const vistaPng = await fetch(`${BASE}${png.json?.message?.attachment?.url}`, { headers: { cookie: B.cookie() } });
  ok("una imagen raster se muestra en línea (con nosniff)", /^inline;/.test(vistaPng.headers.get("content-disposition") ?? "") && vistaPng.headers.get("x-content-type-options") === "nosniff");

  console.log("\n== Grupos y delegación ==");
  const grupo = (c) =>
    c.api("/api/team-chat/groups", { method: "POST", body: JSON.stringify({ name: `Ventas ${S}`, memberIds: [ID.A, ID.B] }) });
  ok("la coordinadora sin delegación no crea grupos (403)", (await grupo(coord)).res.status === 403);
  ok("el asesor tampoco (403)", (await grupo(A)).res.status === 403);
  ok("un asesor no cambia los ajustes (403)", (await A.api("/api/team-chat/settings", { method: "PUT", body: JSON.stringify({ ownerOversight: false }) })).res.status === 403);
  ok("la coordinadora tampoco (solo el Propietario)", (await coord.api("/api/team-chat/settings", { method: "PUT", body: JSON.stringify({ coordinatorsCanCreateGroups: true }) })).res.status === 403);
  await owner.api("/api/team-chat/settings", { method: "PUT", body: JSON.stringify({ coordinatorsCanCreateGroups: true }) });
  const g = await grupo(coord);
  ok("con la delegación, la coordinadora crea el grupo", g.res.status === 201, `status=${g.res.status}`);
  const G = g.json?.threadId;
  ok("A lo ve en su lista", await hasta(async () => (await lista(A)).threads.some((t) => t.id === G)));
  ok("C no", !(await lista(C)).threads.some((t) => t.id === G));
  const saca = await coord.api(`/api/team-chat/groups/${G}`, { method: "PATCH", body: JSON.stringify({ memberIds: [ID.A, ID.coord] }) });
  ok("la coordinadora saca a B del grupo", saca.res.ok);
  ok("B deja de verlo (404)", (await B.api(`/api/team-chat/threads/${G}/messages`)).res.status === 404);
  await owner.api("/api/team-chat/settings", { method: "PUT", body: JSON.stringify({ coordinatorsCanCreateGroups: false }) });
  ok("sin la delegación otra vez: 403", (await coord.api(`/api/team-chat/groups/${G}`, { method: "DELETE" })).res.status === 403);
  ok("el propietario borra el grupo", (await owner.api(`/api/team-chat/groups/${G}`, { method: "DELETE" })).res.status === 204);

  console.log("\n== Supervisión apagada y aviso ==");
  await owner.api("/api/team-chat/settings", { method: "PUT", body: JSON.stringify({ ownerOversight: true, showOversightNotice: true }) });
  ok("supervisión + aviso encendidos → el asesor ve el aviso", (await lista(A)).oversightNotice === true);
  await owner.api("/api/team-chat/settings", { method: "PUT", body: JSON.stringify({ ownerOversight: false }) });
  ok("con la supervisión apagada el aviso no se muestra", (await lista(A)).oversightNotice === false);
  ok("…y el propietario ya no ve el directo (404)", (await owner.api(`/api/team-chat/threads/${D}/messages`)).res.status === 404);
  ok("…ni en su lista", !(await lista(owner)).threads.some((t) => t.id === D));
  const nOwner = sse.owner.del(D).length;
  await post(A, D, `sin supervisión ${S}`);
  ok("B sí lo recibe", await hasta(() => sse.B.del(D).some((e) => JSON.stringify(e.data).includes(`sin supervisión ${S}`))));
  await sleep(300);
  ok("el propietario NO recibe el evento", sse.owner.del(D).length === nOwner);
  await owner.api("/api/team-chat/settings", { method: "PUT", body: JSON.stringify({ ownerOversight: true, showOversightNotice: false }) });

  console.log("\n== Conocimientos en el chat ==");
  const kn = await owner.api("/api/knowledge", { method: "POST", body: JSON.stringify({ title: `Horario ${S}`, body: "Lunes a viernes 9 a 18 h" }) });
  const comp = await owner.api(`/api/team-chat/threads/${avisos.id}/messages/knowledge`, {
    method: "POST",
    body: JSON.stringify({ entryId: kn.json?.entry?.id, mode: "text" }),
  });
  ok("el propietario comparte una entrada en avisos", comp.res.status === 201, `status=${comp.res.status}`);
  ok(
    "C no puede compartir en un directo ajeno (404)",
    (await C.api(`/api/team-chat/threads/${D}/messages/knowledge`, { method: "POST", body: JSON.stringify({ entryId: kn.json?.entry?.id, mode: "text" }) })).res.status === 404
  );

  console.log("\n== Usuario removido ==");
  const directoC = await A.api("/api/team-chat/threads", { method: "POST", body: JSON.stringify({ userId: ID.C }) });
  const DC = directoC.json?.threadId;
  const quita = await owner.api(`/api/settings/team/${memberIdDe(equipo.c[0])}`, { method: "DELETE" });
  ok("el propietario saca a C de la organización", quita.res.ok);
  const nC = sse.C.eventos.length;
  await post(owner, avisos.id, `Aviso tras la salida ${S}`);
  await post(A, DC, `¿sigues ahí? ${S}`);
  ok("A sigue escribiendo", await hasta(() => sse.A.del(avisos.id).some((e) => JSON.stringify(e.data).includes("tras la salida"))));
  await sleep(400);
  ok("C (con su conexión SSE aún abierta) ya no recibe nada", sse.C.eventos.length === nC, `llegaron ${sse.C.eventos.length - nC}`);
  ok("C ya no lee hilos (401)", (await C.api(`/api/team-chat/threads/${DC}/messages`)).res.status === 401);

  for (const s of Object.values(sse)) s.cerrar();

  console.log("\n== Navegador: dos personas en vivo ==");
  await navegador({ A, B, D, ID });

  console.log(`\n${checks - failures}/${checks} checks OK`);
  process.exit(failures ? 1 : 0);
}

/**
 * ¿Aparece a tiempo? (`isVisible({ timeout })` de Playwright NO espera:
 * responde al instante, y un check de "llega en vivo" pasaría o fallaría
 * según la suerte.)
 */
const aparece = (locator, ms = 8000) =>
  locator
    .waitFor({ state: "visible", timeout: ms })
    .then(() => true)
    .catch(() => false);

async function navegador({ A, B, D }) {
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
    const pa = await abrir(A);
    const pb = await abrir(B);
    for (const [tag, p] of [["A", pa], ["B", pb]]) {
      p.on("pageerror", (e) => console.log(`    [${tag}] error de página: ${e.message}`));
      p.on("requestfailed", (q) => !q.url().includes("/api/events") && console.log(`    [${tag}] falló ${q.url()}`));
      p.on("response", (r) => r.status() >= 400 && console.log(`    [${tag}] ${r.status()} ${r.url()}`));
    }
    // Menú expandido para ver el globo del renglón.
    for (const c of [A, B]) await c.api("/api/preferences", { method: "PUT", body: JSON.stringify({ navMode: "expanded" }) });
    await pa.goto(`${BASE}/chat?t=${D}`);
    await pb.goto(`${BASE}/inbox`);
    await pa.getByLabel("Mensaje para el equipo").waitFor({ timeout: 20000 });
    await pb.waitForTimeout(1500);
    const antes = await pb.getByRole("link", { name: /Chat de equipo/ }).innerText();

    const texto = `En vivo ${S}`;
    await pa.getByLabel("Mensaje para el equipo").fill(texto);
    await pa.getByLabel("Mensaje para el equipo").press("Enter");
    ok("A ve su mensaje enviado", await aparece(pa.getByText(texto).first(), 8000));
    ok(
      "a B (en la Bandeja) se le enciende el globo del chat en el menú",
      await hasta(async () => {
        const t = await pb.getByRole("link", { name: /Chat de equipo/ }).innerText();
        return /\d/.test(t) && t !== antes;
      })
    );

    await pb.goto(`${BASE}/chat?t=${D}`);
    const vio = await aparece(pb.getByText(texto).first(), 15000);
    ok("B abre el hilo y lo ve", vio);
    const texto2 = `Sin recargar ${S}`;
    await pa.getByLabel("Mensaje para el equipo").fill(texto2);
    await pa.getByLabel("Mensaje para el equipo").press("Enter");
    const vivo = await aparece(pb.getByText(texto2).first());
    ok("B lo recibe SIN recargar", vivo);

    // Emoji desde frimousse (sin CDN: los datos los sirve la instancia).
    await pa.getByRole("button", { name: "Emojis" }).click();
    await pa.getByLabel("Buscar emoji").fill("fuego");
    const fuego = pa.getByRole("gridcell").first().or(pa.locator('[role="dialog"] button:has-text("🔥")').first());
    await fuego.waitFor({ timeout: 10000 }).catch(() => {});
    await pa.locator('[role="dialog"] button:has-text("🔥")').first().click().catch(() => {});
    ok("el emoji entra al editor", (await pa.getByLabel("Mensaje para el equipo").inputValue()).includes("🔥"));
    await pa.getByLabel("Mensaje para el equipo").press("Enter");
    ok("…y se envía", await aparece(pb.getByText("🔥").first(), 8000));

    // Reacción de B al último mensaje de A.
    const burbuja = pb.locator("[class*='group/msg']").filter({ hasText: texto2 }).first();
    await burbuja.hover();
    await burbuja.getByRole("button", { name: "Reaccionar", exact: true }).click();
    await pb.getByRole("button", { name: "Reaccionar con 👍" }).click();
    ok(
      "A ve la reacción de B en vivo",
      await aparece(pa.locator("button[aria-label^='👍 1']").first(), 8000)
    );
    if (process.env.CAPTURAS_DIR) {
      await pa.screenshot({ path: `${process.env.CAPTURAS_DIR}/chat-equipo-a.png` });
      await pb.screenshot({ path: `${process.env.CAPTURAS_DIR}/chat-equipo-b.png` });
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
