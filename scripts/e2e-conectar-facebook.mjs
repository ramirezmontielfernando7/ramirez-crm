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
 * Uso: node --env-file=.env scripts/e2e-conectar-facebook.mjs
 * Requiere: app corriendo con WA_MOCK_ENABLED=true, BD migrada, META_APP_ID,
 * META_APP_SECRET y META_EMBEDDED_SIGNUP_CONFIG_ID.
 */
import postgres from "postgres";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Math.random().toString(36).slice(2, 8);
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

async function signIn(api, email) {
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
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

await sql.end();
console.log(`\n${checks - failures}/${checks} comprobaciones OK`);
process.exit(failures ? 1 : 0);
