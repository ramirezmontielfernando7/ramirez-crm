/**
 * Self-test E2E de comportamiento — «Conectar con Facebook» (Tech Provider,
 * PR 1; guion tests/e2e/us-conectar-facebook.md).
 *
 * El navegador de un negocio termina el Registro insertado de Meta y manda
 * al servidor el código, la WABA y el número. El servidor cambia el código
 * por el token del negocio (wa-mock imita `oauth/access_token`), registra el
 * número si es nuevo y lo deja conectado por el mismo camino que la conexión
 * manual: token cifrado, app suscrita a la WABA.
 *
 * PR 3 (coexistencia): al conectar el número del celular se piden a Meta los
 * contactos y el historial; llegan por el webhook (`smb_app_state_sync`,
 * `history`) y se guardan como historia: sin no leídos, sin ventana de 24 h,
 * sin leads y sin tocar la IA.
 *
 * Uso: node --env-file=.env scripts/e2e-conectar-facebook.mjs
 * Requiere: app corriendo con WA_MOCK_ENABLED=true, BD migrada, META_APP_ID,
 * META_APP_SECRET y META_EMBEDDED_SIGNUP_CONFIG_ID.
 */
import { createHmac } from "node:crypto";
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Math.random().toString(36).slice(2, 8);
const IP = `10.97.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;
const N = () => String(Math.floor(1e8 + Math.random() * 9e8));
const WABA_NUEVO = `7${N()}`;
const PN_NUEVO = `8${N()}`;
const WABA_CEL = `7${N()}`;
const PN_CEL = `8${N()}`;

let failures = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
};

function client() {
  let cookie = "";
  return async function api(path, opts = {}) {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      headers: {
        "content-type": "application/json",
        // IP propia del guion: el freno de login por IP (FR-062) no se
        // comparte con los demás guiones del mismo job.
        "x-forwarded-for": IP,
        origin: BASE,
        ...(cookie ? { cookie } : {}),
        ...(opts.headers ?? {}),
      },
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
    let json = null;
    try {
      json = await res.clone().json();
    } catch {}
    return { res, json };
  };
}

// Login primero (una sola llamada) y, por si acaso, espera ante un 429.
async function signIn(api, email) {
  const password = "password-e2e-123";
  let su;
  for (let intento = 0; intento < 10; intento++) {
    su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
    if (su.res.status !== 429) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!su.res.ok) {
    su = await api("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ email, password, name: "Operador E2E" }),
    });
  }
  return su.res.ok;
}

const sql = postgres(process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL, {
  max: 1,
  onnotice: () => {},
  connection: { TimeZone: "UTC" },
});

const post = (api, body) =>
  api("/api/settings/whatsapp/embedded-signup", { method: "POST", body: JSON.stringify(body) });

console.log("== Número nuevo ==");
const a = client();
// El mismo operador de los demás guiones: el registro abierto solo crea la
// primera cuenta de la instancia.
ok("registro o login del operador", await signIn(a, "e2e@vocero.test"));

const cfg = (await a("/api/settings/whatsapp")).json;
const before = JSON.stringify(cfg?.connection ?? null);
ok("la pantalla recibe la configuración pública del botón", cfg?.embeddedSignup?.configId === process.env.META_EMBEDDED_SIGNUP_CONFIG_ID, JSON.stringify(cfg));
ok("y nunca el App Secret", !JSON.stringify(cfg).includes(process.env.META_APP_SECRET ?? "nunca"));

let r = await post(a, { code: `cod-${RUN}`, wabaId: WABA_NUEVO, phoneNumberId: PN_NUEVO, flow: "new_number" });
ok("número nuevo sin PIN → 422 pin_required", r.res.status === 422 && r.json?.error?.code === "pin_required", JSON.stringify(r.json));

r = await post(a, { code: `vencido-${RUN}`, wabaId: WABA_NUEVO, phoneNumberId: PN_NUEVO, flow: "new_number", pin: "123456" });
ok("código vencido → 422 code_expired con mensaje en español", r.res.status === 422 && r.json?.error?.code === "code_expired", JSON.stringify(r.json));
ok("y no se tocó la conexión", JSON.stringify((await a("/api/settings/whatsapp")).json?.connection ?? null) === before);

r = await post(a, { code: `cod-pin-${RUN}`, wabaId: WABA_NUEVO, phoneNumberId: PN_NUEVO, flow: "new_number", pin: "000000" });
ok("PIN distinto al del número → 422 pin_mismatch", r.res.status === 422 && r.json?.error?.code === "pin_mismatch", JSON.stringify(r.json));
ok("y tampoco se tocó", JSON.stringify((await a("/api/settings/whatsapp")).json?.connection ?? null) === before);

r = await post(a, { code: `cod-a-${RUN}`, wabaId: WABA_NUEVO, phoneNumberId: PN_NUEVO, flow: "new_number", pin: "123456" });
ok("con código y PIN → 200 conectado", r.res.status === 200 && r.json?.ok === true, JSON.stringify(r.json));

const conn = (await a("/api/settings/whatsapp")).json?.connection;
ok("la conexión queda guardada con el número de Meta", conn?.phoneNumberId === PN_NUEVO && conn?.status === "connected", JSON.stringify(conn));
ok("se muestran solo los últimos 4 del token del negocio", conn?.tokenLast4 === `cod-a-${RUN}`.slice(-4), conn?.tokenLast4);

const [row] = await sql`select token_cipher from meta_credentials where phone_number_id = ${PN_NUEVO}`;
ok("el token queda cifrado en la BD (no en claro)", row && !row.token_cipher.includes(`es-token-cod-a-${RUN}`));

const GRAPH = process.env.META_GRAPH_BASE_URL;
const graph = (path) =>
  fetch(`${GRAPH}/v25.0/${path}`, { headers: { authorization: "Bearer e2e" } }).then((res) => res.json());
const platformOf = async (pn) => (await graph(`${pn}?fields=platform_type`)).platform_type;
ok("el número nuevo se registró en la Cloud API", (await platformOf(PN_NUEVO)) === "CLOUD_API");
ok("la app quedó suscrita a la WABA del negocio", ((await graph(`${WABA_NUEVO}/subscribed_apps`)).data ?? []).length === 1);

console.log("\n== El mismo negocio cambia a su número de WhatsApp Business del celular ==");
r = await post(a, { code: `cod-cel-${RUN}`, wabaId: WABA_CEL, phoneNumberId: PN_CEL, flow: "business_app" });
ok("coexistencia sin PIN → 200 conectado", r.res.status === 200 && r.json?.ok === true, JSON.stringify(r.json));
ok("la conexión ahora es el número del celular", (await a("/api/settings/whatsapp")).json?.connection?.phoneNumberId === PN_CEL);
ok("y NO se re-registra el número (ya lo está en el celular)", (await platformOf(PN_CEL)) === "NOT_APPLICABLE");

console.log("\n== Coexistencia: contactos y chats del celular ==");
ok("se pidieron a Meta los contactos y el historial", r.json?.historyRequested === true);
const pedidas = (await graph(`${PN_CEL}/smb_app_data`)).data ?? [];
ok("…una vez cada uno", pedidas.filter((t) => t === "history").length === 1 && pedidas.filter((t) => t === "smb_app_state_sync").length === 1, JSON.stringify(pedidas));

const NEGOCIO = "5215511112222";
const CLIENTE = `5255${N().slice(0, 8)}`;
const OTRO = `5255${N().slice(0, 8)}`;
const ts = (diasAtras) => String(Math.floor(Date.now() / 1000) - diasAtras * 86400);
async function webhookWa(field, value) {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: WABA_CEL, changes: [{ field, value }] }] });
  const firma = `sha256=${createHmac("sha256", process.env.META_APP_SECRET ?? "").update(body).digest("hex")}`;
  const res = await fetch(`${BASE}/api/webhooks/wa/${process.env.META_WEBHOOK_VERIFY_TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-signature-256": firma },
    body,
  });
  return res.status;
}
const meta = { display_phone_number: NEGOCIO, phone_number_id: PN_CEL };
const [orgRow] = await sql`select organization_id from meta_credentials where phone_number_id = ${PN_CEL}`;
const ORG = orgRow?.organization_id;
const hasta = async (fn, ms = 15000) => {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > fin) return v;
    await new Promise((res) => setTimeout(res, 300));
  }
};

let st = await webhookWa("smb_app_state_sync", {
  messaging_product: "whatsapp",
  metadata: meta,
  state_sync: [
    { type: "contact", action: "add", contact: { full_name: `Ana Celular ${RUN}`, first_name: "Ana", phone_number: CLIENTE }, metadata: { timestamp: ts(0) } },
    { type: "contact", action: "remove", contact: { phone_number: OTRO }, metadata: { timestamp: ts(0) } },
  ],
});
ok("webhook de contactos → 200", st === 200, String(st));
const ana = await hasta(async () => (await sql`select id, name from contact where organization_id = ${ORG} and wa_identity = ${CLIENTE}`)[0]);
ok("el contacto del celular entra con su nombre", ana?.name === `Ana Celular ${RUN}`, JSON.stringify(ana));
ok("«remove» no crea ni borra nada", (await sql`select count(*)::int n from contact where organization_id = ${ORG} and wa_identity = ${OTRO}`)[0].n === 0);

const W = (n) => `wamid.hist.${RUN}.${n}`;
st = await webhookWa("history", {
  messaging_product: "whatsapp",
  metadata: meta,
  history: [
    {
      metadata: { phase: 0, chunk_order: 1, progress: 50 },
      threads: [
        {
          id: CLIENTE,
          messages: [
            { from: CLIENTE, id: W(1), timestamp: ts(30), type: "text", text: { body: "Hola, ¿tienen informes?" }, history_context: { status: "READ" } },
            { from: NEGOCIO, to: CLIENTE, id: W(2), timestamp: ts(29), type: "text", text: { body: "¡Claro! Te mando la info" }, history_context: { status: "READ" } },
            { from: NEGOCIO, to: CLIENTE, id: W(3), timestamp: ts(2), type: "media_placeholder", history_context: { status: "DELIVERED" } },
          ],
        },
      ],
    },
  ],
});
ok("webhook de historial → 200", st === 200, String(st));
const msgs = await hasta(async () => {
  const rows = await sql`select wa_message_id, direction, origin, type, status, text from message where wa_message_id like ${`wamid.hist.${RUN}.%`} order by wa_message_id`;
  return rows.length === 3 ? rows : null;
});
ok("los 3 mensajes del historial quedan en el chat", msgs?.length === 3, JSON.stringify(msgs));
ok("el del cliente es entrante y los del negocio salientes «a mano»", msgs?.[0]?.direction === "in" && msgs?.[1]?.direction === "out" && msgs?.[1]?.origin === "manual");
ok("el estado de Meta se conserva (leído)", msgs?.[1]?.status === "read");
const [conv] = await sql`select c.unread_count, c.last_inbound_at, c.ai_enabled, c.handoff_at, c.last_message_at from conversation c join contact ct on ct.id = c.contact_id where ct.organization_id = ${ORG} and ct.wa_identity = ${CLIENTE}`;
ok("el chat aparece sin no leídos", conv?.unread_count === 0, JSON.stringify(conv));
ok("no abre la ventana de 24 h", conv?.last_inbound_at === null);
ok("no pausa la IA", conv?.handoff_at === null);
ok("su hora es la del último mensaje del historial", conv && Math.abs(new Date(conv.last_message_at).getTime() - Number(ts(2)) * 1000) < 5000);
const bandeja = (await a("/api/conversations")).json?.conversations ?? [];
ok("y se ve en la Bandeja con el nombre del celular", bandeja.some((c) => c.contact?.name === `Ana Celular ${RUN}`), `${bandeja.length} chats`);
ok("no crea un lead (es historia)", (await sql`select count(*)::int n from lead where contact_id = ${ana?.id}`)[0].n === 0);

st = await webhookWa("history", {
  messaging_product: "whatsapp",
  metadata: meta,
  history: [{ metadata: { phase: 0, chunk_order: 2, progress: 100 }, threads: [{ id: CLIENTE, messages: [
    { from: NEGOCIO, to: CLIENTE, id: W(3), timestamp: ts(2), type: "image", image: { id: `media-hist-${RUN}`, mime_type: "image/jpeg", caption: "Folleto" }, history_context: { status: "DELIVERED" } },
  ] }] }],
});
const foto = await hasta(async () => (await sql`select type, text, media_asset_id from message where wa_message_id = ${W(3)} and media_asset_id is not null`)[0]);
ok("el archivo que llega después completa el mensaje del historial", foto?.type === "image" && foto?.text === "Folleto", JSON.stringify(foto));
ok("y no se duplica", (await sql`select count(*)::int n from message where wa_message_id = ${W(3)}`)[0].n === 1);

st = await webhookWa("history", { messaging_product: "whatsapp", metadata: meta, history: [{ errors: [{ code: 2593109, message: "History sharing is turned off by user" }] }] });
ok("si el negocio no comparte su historial, el webhook responde 200 sin romperse", st === 200);

st = await webhookWa("history", { messaging_product: "whatsapp", metadata: meta, history: [{ threads: [{ id: CLIENTE, messages: [
  { from: CLIENTE, id: W(1), timestamp: ts(30), type: "text", text: { body: "Hola, ¿tienen informes?" } },
] }] }] });
await new Promise((res) => setTimeout(res, 1000));
ok("un lote repetido no duplica mensajes", (await sql`select count(*)::int n from message where wa_message_id like ${`wamid.hist.${RUN}.%`}`)[0].n === 3);

await sql.end();
console.log(`\n${checks - failures}/${checks} comprobaciones OK`);
process.exit(failures ? 1 : 0);
