/**
 * Self-test E2E de Campañas v2, PR 1 — fundamentos de datos de Meta
 * (specs/030-campanas-v2/spec.md, guion tests/e2e/us-datos-meta.md).
 *
 * Conduce la app REAL contra la BD de verdad y el wa-mock:
 *   1. Estados del mensaje: hora de cada estado, `pricing` tal cual, un
 *      `failed` tardío NO pisa un `delivered`, y el 131049 traducido.
 *   2. Bajas por palabra clave (STOP/BAJA): opt_out, línea de tiempo, solo
 *      el mensaje completo, botón de la plantilla, respuesta automática
 *      apagada por defecto y encendida a pedido.
 *   3. Salud del número: «Actualizar» (y su freno de 1/min), respaldo a los
 *      campos mínimos, webhooks de calidad y de cuenta, alertas.
 *   4. Plantillas: importación paginada de las que ya existen en la WABA,
 *      componentes completos, pausa de Meta, creación con encabezado, pie y
 *      botones (e imagen si META_APP_ID está definido), envío con imagen,
 *      cambio de categoría con aviso.
 *   5. Interfaz: Ajustes → WhatsApp y Plantillas en un navegador real.
 *
 * Uso:
 *   1) app corriendo con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock y
 *      BD migrada (de preferencia con META_APP_ID=<dígitos> para el camino de
 *      la imagen; sin ella se prueba que la opción esté deshabilitada)
 *   2) node --env-file=.env scripts/e2e-datos-meta.mjs
 *
 * Re-ejecutable: cada corrida usa números, plantillas y teléfonos nuevos.
 * Sale con 1 si algo falla.
 */
import postgres from "postgres";
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const STAMP = Date.now().toString(36);
const PN = `9${RUN}01`;
const WABA = `8${RUN}02`;
const sql = postgres(process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL, { max: 2, onnotice: () => {} });

let cookie = "";
let failures = 0;
let checks = 0;
function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...(isForm ? {} : { "content-type": "application/json" }),
      origin: BASE,
      "x-forwarded-for": `10.77.${Number(RUN.slice(-3)) % 256}.9`,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {
    // sin JSON
  }
  return { res, json };
}
const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body) });

/** Espera a que `fn` devuelva algo verdadero (los webhooks se procesan en after()). */
async function until(fn, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await sleep(250);
  }
}

async function outbox() {
  return (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
}

let inboundN = 0;
/** Id propio por entrante: el contador del mock se reinicia con el servidor y la ingesta descarta ids repetidos. */
async function inbound(from, extra) {
  return post("/api/dev/wa-mock/inbound", {
    phoneNumberId: PN,
    from,
    name: `Cliente ${from.slice(-4)}`,
    waMessageId: `wamid.e2e.meta.${RUN}.${++inboundN}`,
    ...extra,
  });
}

/** La conversación del contacto, una vez que la ingesta registró su entrante (ventana abierta). */
async function conversationOf(phone) {
  return until(async () => {
    const [row] = await sql`
      select cv.id, ct.id as contact_id, ct.organization_id
      from conversation cv join contact ct on ct.id = cv.contact_id and ct.organization_id = cv.organization_id
      where ct.wa_identity = ${phone} and cv.is_test = false and cv.last_inbound_at is not null
      order by cv.created_at desc limit 1`;
    return row ?? null;
  });
}

async function main() {
  console.log("== Setup: operador + número de WhatsApp nuevo ==");
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await post("/api/auth/sign-in/email", { email, password });
  if (!su.res.ok) su = await post("/api/auth/sign-up/email", { email, password, name: "Operador E2E" });
  ok("login del operador", su.res.ok, JSON.stringify(su.json));
  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: WABA, phoneNumberId: PN, token: `tok-meta-${RUN}` }),
  });
  ok("conexión WhatsApp guardada", conn.res.ok, JSON.stringify(conn.json));

  /* ------------------------------------------------------------ */
  console.log("\n== 1. Estados del mensaje: horas, precios, failed tardío, 131049 ==");
  const phone1 = `52155${RUN}1`;
  await inbound(phone1, { text: "hola" });
  const c1 = await conversationOf(phone1.replace(/^521/, "52"));
  ok("el entrante crea la conversación", !!c1);
  const sent = await post(`/api/conversations/${c1?.id}/messages`, { text: `Hola, gracias por escribir ${RUN}` });
  ok("el CRM responde", sent.res.ok, JSON.stringify(sent.json));
  const box = await outbox();
  const out1 = [...box].reverse().find((e) => JSON.stringify(e.body).includes(`gracias por escribir ${RUN}`));
  ok("Meta (mock) recibió el saliente", !!out1?.waMessageId);
  const t0 = Math.floor(Date.now() / 1000);
  await post("/api/dev/wa-mock/status", {
    waMessageId: out1.waMessageId,
    status: "sent",
    timestamp: t0,
    pricing: { billable: true, pricing_model: "PMP", category: "service", type: "regular" },
  });
  await post("/api/dev/wa-mock/status", { waMessageId: out1.waMessageId, status: "delivered", timestamp: t0 + 5 });
  await post("/api/dev/wa-mock/status", {
    waMessageId: out1.waMessageId,
    status: "failed",
    timestamp: t0 + 9,
    errorCode: 131049,
    errorMessage: "healthy ecosystem",
  });
  const m1 = await until(async () => {
    const [r] = await sql`select * from message where wa_message_id = ${out1.waMessageId}`;
    return r?.delivered_at ? r : null;
  });
  ok("estado sigue en delivered (el failed tardío no lo pisa)", m1?.status === "delivered", m1?.status);
  ok("sent_at y delivered_at con la hora de Meta", m1?.sent_at && m1?.delivered_at && new Date(m1.delivered_at).getTime() === (t0 + 5) * 1000);
  ok("sin failed_at ni error", !m1?.failed_at && !m1?.error);
  ok(
    "pricing guardado tal cual",
    m1?.pricing_billable === true && m1?.pricing_model === "PMP" && m1?.pricing_category === "service" && m1?.pricing_type === "regular",
    JSON.stringify({ b: m1?.pricing_billable, c: m1?.pricing_category })
  );

  const sent2 = await post(`/api/conversations/${c1?.id}/messages`, { text: `segundo ${RUN}` });
  ok("segundo saliente", sent2.res.ok);
  const out2 = [...(await outbox())].reverse().find((e) => JSON.stringify(e.body).includes(`segundo ${RUN}`));
  await post("/api/dev/wa-mock/status", { waMessageId: out2.waMessageId, status: "sent" });
  await post("/api/dev/wa-mock/status", { waMessageId: out2.waMessageId, status: "failed", errorCode: 131049, errorMessage: "x" });
  const m2 = await until(async () => {
    const [r] = await sql`select * from message where wa_message_id = ${out2.waMessageId}`;
    return r?.status === "failed" ? r : null;
  });
  ok("failed desde sent: código 131049", m2?.error_code === 131049, String(m2?.error_code));
  ok("y su traducción al español", /marketing/i.test(m2?.error ?? ""), m2?.error);
  const thread = (await api(`/api/conversations/${c1?.id}/messages`)).json?.messages ?? [];
  ok("la bandeja muestra el motivo del fallo", thread.some((m) => m.status === "failed" && /marketing/i.test(m.error ?? "")));

  /* ------------------------------------------------------------ */
  console.log("\n== 2. Bajas por palabra clave ==");
  const settings0 = (await api("/api/settings/messaging")).json?.settings;
  ok("respuesta automática apagada por defecto", settings0?.stopReplyEnabled === false, JSON.stringify(settings0));
  await sql`update contact set wa_consent = 'opt_in' where id = ${c1?.contact_id}`;
  const before = (await outbox()).length;
  await inbound(phone1, { text: "¡BAJA!" });
  const ct1 = await until(async () => {
    const [r] = await sql`select wa_consent, wa_consent_source from contact where id = ${c1?.contact_id}`;
    return r?.wa_consent === "opt_out" ? r : null;
  });
  ok("«¡BAJA!» → opt_out", ct1?.wa_consent === "opt_out", JSON.stringify(ct1));
  const tl = (await api(`/api/contacts/${c1?.contact_id}/timeline`)).json?.items ?? [];
  ok("la baja queda en la línea de tiempo", JSON.stringify(tl).includes("opt_out"));
  await sleep(500);
  ok("sin respuesta automática (apagada)", (await outbox()).length === before, `${before} → ${(await outbox()).length}`);

  const phone2 = `52155${RUN}2`;
  await inbound(phone2, { text: "no me des de baja porfa" });
  const c2 = await conversationOf(phone2.replace(/^521/, "52"));
  const [ct2] = await sql`select wa_consent from contact where id = ${c2?.contact_id}`;
  ok("un mensaje que solo CONTIENE la palabra no da de baja", ct2?.wa_consent === "desconocido", ct2?.wa_consent);

  const put = await api("/api/settings/messaging", {
    method: "PUT",
    body: JSON.stringify({
      stopKeywordsEnabled: true,
      stopKeywords: ["baja", "stop", "detener promociones"],
      stopReplyEnabled: true,
      stopReplyText: `Listo, ya no recibirás promociones ${RUN}`,
      usageAlertPercent: 80,
    }),
  });
  ok("Ajustes: respuesta automática encendida", put.res.ok, JSON.stringify(put.json));
  const bad = await api("/api/settings/messaging", {
    method: "PUT",
    body: JSON.stringify({ stopKeywordsEnabled: true, stopKeywords: [], stopReplyEnabled: false, stopReplyText: null, usageAlertPercent: 80 }),
  });
  ok("no se puede guardar la función encendida sin palabras (422)", bad.res.status === 422, String(bad.res.status));
  await inbound(phone2, { text: "Stop" });
  const reply = await until(async () =>
    (await outbox()).find((e) => JSON.stringify(e.body).includes(`ya no recibirás promociones ${RUN}`))
  );
  ok("«Stop» → respuesta automática enviada", !!reply);
  const phone3 = `52155${RUN}3`;
  await inbound(phone3, { type: "button", text: "Detener promociones" });
  const c3 = await conversationOf(phone3.replace(/^521/, "52"));
  const ct3 = await until(async () => {
    const [r] = await sql`select wa_consent from contact where id = ${c3?.contact_id}`;
    return r?.wa_consent === "opt_out" ? r : null;
  });
  ok("botón «Detener promociones» de la plantilla → opt_out", ct3?.wa_consent === "opt_out");
  const [btnMsg] = await sql`select type, text from message where conversation_id = ${c3?.id} and direction = 'in'`;
  ok("el toque del botón entra a la bandeja como texto", btnMsg?.type === "text" && btnMsg?.text === "Detener promociones", JSON.stringify(btnMsg));
  // Deja la respuesta automática apagada otra vez (default).
  await api("/api/settings/messaging", {
    method: "PUT",
    body: JSON.stringify({ stopKeywordsEnabled: true, stopKeywords: ["baja", "dar de baja", "darme de baja", "detener promociones", "stop", "stop promotions", "unsubscribe"], stopReplyEnabled: false, stopReplyText: null, usageAlertPercent: 80 }),
  });

  /* ------------------------------------------------------------ */
  console.log("\n== 3. Salud del número ==");
  const h0 = await api("/api/number-health");
  ok("GET salud 200", h0.res.ok, JSON.stringify(h0.json));
  ok("sin lectura de hoy para el número nuevo", h0.json?.connected === true && h0.json?.today === null, JSON.stringify(h0.json?.today));
  const h1 = await api("/api/number-health", { method: "POST" });
  ok("«Actualizar» lee de Meta", h1.res.ok && h1.json?.today?.qualityRating === "GREEN", JSON.stringify(h1.json));
  ok("límite leído de Meta (TIER_1K → 1000)", h1.json?.today?.messagingLimitValue === 1000, JSON.stringify(h1.json?.today));
  const h2 = await api("/api/number-health", { method: "POST" });
  ok("segunda lectura en menos de un minuto → 429", h2.res.status === 429, String(h2.res.status));

  const orgId = c1?.organization_id;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await sql`
    insert into wa_phone_health (id, organization_id, phone_number_id, day, quality_rating, messaging_limit, messaging_limit_value, status, source)
    values (${`wph_e2e_${RUN}`}, ${orgId}, ${PN}, ${yesterday}, 'GREEN', 'TIER_1K', 1000, 'CONNECTED', 'sync')
    on conflict do nothing`;
  await sql`update wa_phone_health set fetched_at = now() - interval '2 minutes' where organization_id = ${orgId}`;
  await post("/api/dev/wa-mock/health", { phoneNumberId: PN, quality_rating: "RED", status: "FLAGGED", rejectNewFields: true });
  const h3 = await api("/api/number-health", { method: "POST" });
  ok("Meta rechaza campos nuevos → se reintenta con el mínimo y lee igual", h3.res.ok && h3.json?.today?.qualityRating === "RED", JSON.stringify(h3.json?.today));
  const codes = (h3.json?.alerts ?? []).map((a) => a.code);
  ok("alertas: calidad baja, caída de calidad y estado del número", ["quality_low", "quality_dropped", "number_status"].every((c) => codes.includes(c)), codes.join(","));

  const q = await post("/api/dev/wa-mock/waba-event", {
    wabaId: WABA,
    field: "phone_number_quality_update",
    value: { display_phone_number: "5215500000000", event: "DOWNGRADE", current_limit: "TIER_250" },
  });
  ok("webhook phone_number_quality_update entregado", q.res.ok, JSON.stringify(q.json));
  const h4 = await until(async () => {
    const r = await api("/api/number-health");
    return r.json?.today?.messagingLimit === "TIER_250" ? r : null;
  });
  ok("el webhook baja el límite a 250 sin borrar la calidad", h4?.json?.today?.messagingLimitValue === 250 && h4?.json?.today?.qualityRating === "RED", JSON.stringify(h4?.json?.today));
  await post("/api/dev/wa-mock/waba-event", {
    wabaId: WABA,
    field: "account_update",
    value: { phone_number: "5215500000000", event: "ACCOUNT_RESTRICTION", restriction_info: [{ restriction_type: "RESTRICTED_ADD_PHONE_NUMBER_ACTION" }] },
  });
  const h5 = await until(async () => {
    const r = await api("/api/number-health");
    return (r.json?.alerts ?? []).some((a) => a.code === "account_event") ? r : null;
  });
  ok("webhook account_update → alerta de cuenta", !!h5);
  await post("/api/dev/wa-mock/health", { phoneNumberId: PN, reset: true });
  const otherWaba = await post("/api/dev/wa-mock/waba-event", {
    wabaId: `WABA-NADIE-${RUN}`,
    field: "account_update",
    value: { event: "ACCOUNT_VIOLATION" },
  });
  // El webhook se procesa en after(): se espera a que quede guardado.
  const unrouted = await until(async () => {
    const [r] = await sql`select count(*)::int as n from webhook_unrouted where route_key = ${`WABA-NADIE-${RUN}`}`;
    return r?.n > 0 ? r : null;
  });
  ok("evento de una WABA sin organización: guardado como sin ruta", otherWaba.res.ok && unrouted?.n === 1, JSON.stringify(unrouted));

  /* ------------------------------------------------------------ */
  console.log("\n== 4. Plantillas: importación paginada, componentes, pausa ==");
  const seeded = [];
  for (let i = 0; i < 5; i++) {
    const name = `existente_${STAMP}_${i}`;
    const components =
      i === 0
        ? [
            { type: "HEADER", format: "TEXT", text: "Promo de octubre" },
            { type: "BODY", text: "Hola {{1}}, tenemos algo para ti", example: { body_text: [["Ana"]] } },
            { type: "FOOTER", text: "Responde BAJA para no recibir más" },
            { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Me interesa" }, { type: "URL", text: "Ver", url: "https://ejemplo.com" }] },
          ]
        : i === 3
          ? [{ type: "HEADER", format: "VIDEO" }, { type: "BODY", text: "Mira esto" }]
          : [{ type: "BODY", text: `Plantilla ${i}` }];
    const r = await post("/api/dev/wa-mock/seed-template", {
      wabaId: WABA,
      name,
      category: "MARKETING",
      status: i === 4 ? "PAUSED" : "APPROVED",
      components,
      qualityScore: i === 4 ? "RED" : "GREEN",
    });
    if (r.res.ok) seeded.push(name);
  }
  ok("5 plantillas existentes en la WABA (simulada)", seeded.length === 5);
  const sync1 = await api("/api/templates/sync", { method: "POST" });
  ok("sincronización 200", sync1.res.ok, JSON.stringify(sync1.json));
  let list = (await api("/api/templates")).json?.templates ?? [];
  const imported = list.filter((t) => seeded.includes(t.name));
  ok("las 5 importadas (paginación de 2 en 2)", imported.length === 5, String(imported.length));
  const full = imported.find((t) => t.name.endsWith("_0"));
  ok(
    "componentes completos: encabezado, cuerpo, pie y botones",
    full?.components?.length === 4 && full?.body === "Hola {{1}}, tenemos algo para ti" && full?.sendable === true,
    JSON.stringify(full)
  );
  const paused = imported.find((t) => t.name.endsWith("_4"));
  ok("pausada por Meta: aprobada pero NO enviable", paused?.status === "approved" && paused?.metaStatus === "PAUSED" && paused?.sendable === false, JSON.stringify(paused));
  const video = imported.find((t) => t.name.endsWith("_3"));
  ok("encabezado de video: no enviable, con motivo", video?.sendable === false && /VIDEO/.test(video?.unsendableReason ?? ""), video?.unsendableReason);
  const sync2 = await api("/api/templates/sync", { method: "POST" });
  ok("segunda sincronización no reescribe nada", sync2.json?.updated === 0, JSON.stringify(sync2.json));
  const pausedSend = await post(`/api/conversations/${c1?.id}/messages/template`, { templateId: paused?.id, variables: [] });
  ok("enviar la pausada: 422 con motivo en español", pausedSend.res.status === 422 && /paus/i.test(pausedSend.json?.error?.message ?? ""), JSON.stringify(pausedSend.json));

  console.log("\n== 4b. Crear plantilla completa desde el CRM ==");
  const tplName = `completa_${STAMP}`;
  const created = await post("/api/templates", {
    name: tplName,
    language: "es_MX",
    category: "UTILITY",
    body: "Hola {{1}}, tu cita es el {{2}}",
    bodyExamples: ["Ana", "lunes 10:00"],
    header: { format: "TEXT", text: "Tu cita" },
    footer: "Clínica Demo",
    buttons: [{ type: "QUICK_REPLY", text: "Confirmo" }, { type: "URL", text: "Ubicación", url: "https://maps.example.com" }],
  });
  ok("creada con encabezado, pie, botones y ejemplos (201)", created.res.status === 201, JSON.stringify(created.json));
  ok(
    "guarda los 4 componentes",
    created.json?.template?.components?.map((c) => c.type).join(",") === "HEADER,BODY,FOOTER,BUTTONS",
    JSON.stringify(created.json?.template?.components)
  );
  const noEx = await post("/api/templates", {
    name: `sin_ejemplo_${STAMP}`,
    language: "es_MX",
    category: "UTILITY",
    body: "Hola {{1}}",
    bodyExamples: [""],
  });
  ok("sin ejemplo para {{1}} → 422 antes de llamar a Meta", noEx.res.status === 422, JSON.stringify(noEx.json));
  const legacy = await post("/api/templates", { name: `legado_${STAMP}`, language: "es_MX", category: "UTILITY", body: "Hola {{1}}" });
  ok("contrato anterior (solo cuerpo) sigue funcionando", legacy.res.status === 201, JSON.stringify(legacy.json));

  const appId = /^\d+$/.test(process.env.META_APP_ID ?? "");
  const tplList = (await api("/api/templates")).json;
  ok("la API dice si la imagen está disponible (META_APP_ID)", tplList?.headerImageAvailable === appId, String(tplList?.headerImageAvailable));
  const png = Uint8Array.from(
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
  );
  const form = new FormData();
  const imgName = `con_imagen_${STAMP}`;
  form.set(
    "draft",
    JSON.stringify({ name: imgName, language: "es_MX", category: "MARKETING", body: "Mira nuestra promo", header: { format: "IMAGE" }, buttons: [] })
  );
  form.set("headerImage", new Blob([png], { type: "image/png" }), "promo.png");
  const withImg = await api("/api/templates", { method: "POST", body: form });
  if (appId) {
    ok("con META_APP_ID: plantilla con imagen creada (subida reanudable)", withImg.res.status === 201 && withImg.json?.template?.hasHeaderImage === true, JSON.stringify(withImg.json));
    await post("/api/dev/wa-mock/template-status", { wabaId: WABA, name: imgName, language: "es_MX", event: "APPROVED" });
    const imgTpl = await until(async () =>
      ((await api("/api/templates")).json?.templates ?? []).find((t) => t.name === imgName && t.status === "approved")
    );
    ok("Meta la aprueba (webhook)", !!imgTpl);
    const sendImg = await post(`/api/conversations/${c2?.id}/messages/template`, { templateId: imgTpl?.id, variables: [] });
    ok("se envía con la imagen del encabezado", sendImg.res.ok, JSON.stringify(sendImg.json));
    const outImg = [...(await outbox())].reverse().find((e) => e.body?.template?.name === imgName);
    const headerParam = outImg?.body?.template?.components?.find((c) => c.type === "header")?.parameters?.[0];
    ok("el envío lleva la imagen (media id)", headerParam?.type === "image" && !!headerParam?.image?.id, JSON.stringify(headerParam));
  } else {
    ok("sin META_APP_ID: imagen rechazada con explicación", withImg.res.status === 422 && /META_APP_ID/.test(withImg.json?.error?.message ?? ""), JSON.stringify(withImg.json));
  }

  console.log("\n== 4c. Estado y categoría por webhook ==");
  const createdId = created.json?.template?.id;
  await post("/api/dev/wa-mock/template-status", { wabaId: WABA, name: tplName, language: "es_MX", event: "APPROVED" });
  await until(async () => ((await api("/api/templates")).json?.templates ?? []).find((t) => t.id === createdId && t.status === "approved"));
  await post("/api/dev/wa-mock/template-status", { wabaId: WABA, name: tplName, language: "es_MX", event: "PAUSED", reason: "Baja calidad" });
  const pausedNow = await until(async () =>
    ((await api("/api/templates")).json?.templates ?? []).find((t) => t.id === createdId && t.metaStatus === "PAUSED")
  );
  ok("webhook PAUSED: queda pausada con motivo", pausedNow?.sendable === false && pausedNow?.pausedReason === "Baja calidad", JSON.stringify(pausedNow));
  const mockTplId = (await sql`select wa_template_id from template where id = ${createdId}`)[0]?.wa_template_id;
  await post("/api/dev/wa-mock/waba-event", {
    wabaId: WABA,
    field: "template_category_update",
    value: { message_template_id: mockTplId, message_template_name: tplName, message_template_language: "es_MX", previous_category: "UTILITY", old_category: "UTILITY", new_category: "MARKETING" },
  });
  const changed = await until(async () =>
    ((await api("/api/templates")).json?.templates ?? []).find((t) => t.id === createdId && t.categoryChange)
  );
  ok("webhook de categoría: UTILITY → MARKETING con aviso", changed?.category === "MARKETING" && changed?.categoryChange?.from === "UTILITY", JSON.stringify(changed?.categoryChange));

  /* ------------------------------------------------------------ */
  console.log("\n== 5. Interfaz (navegador real) ==");
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  try {
    const ctx = await browser.newContext();
    const host = new URL(BASE).hostname;
    await ctx.addCookies(
      cookie.split("; ").map((c) => {
        const [n, ...v] = c.split("=");
        return { name: n, value: v.join("="), domain: host, path: "/" };
      })
    );
    const page = await ctx.newPage();
    await page.goto(`${BASE}/settings/templates`, { timeout: 180000 });
    const banner = page.getByTestId("template-category-changes");
    await banner.waitFor({ timeout: 60000 });
    ok("Plantillas: aviso de cambio de categoría visible", await banner.isVisible());
    await page.getByRole("button", { name: "Entendido" }).click();
    await banner.waitFor({ state: "detached", timeout: 30000 });
    const seen = ((await api("/api/templates")).json?.templates ?? []).find((t) => t.id === createdId);
    ok("«Entendido» lo marca como visto", seen?.categoryChange === null);
    await page.getByLabel("Encabezado").selectOption("TEXT");
    await page.getByLabel("Texto del encabezado").fill("Hola");
    await page.getByLabel("Cuerpo").fill("Hola {{1}}");
    ok("formulario: pide el ejemplo de {{1}}", await page.getByLabel("Ejemplo de {{1}}").isVisible());

    await page.goto(`${BASE}/settings/whatsapp`, { timeout: 180000 });
    // Las tarjetas se llenan con su propia petición: se espera a que lleguen.
    const visible = (testId) =>
      page.getByTestId(testId).waitFor({ timeout: 60000 }).then(
        () => true,
        (err) => {
          console.log(`    (no apareció ${testId}: ${err.message.split("\n")[0]})`);
          return false;
        }
      );
    ok("Ajustes → WhatsApp: tarjeta de salud del número", await visible("health-limit"));
    ok("Ajustes → WhatsApp: bajas por palabra clave", await visible("opt-out-settings"));
    const alertBanner = page.getByTestId("number-health-banner");
    await alertBanner.waitFor({ timeout: 30000 });
    ok("aviso global de salud del número (calidad baja / restricción)", await alertBanner.isVisible());
  } finally {
    await browser.close();
  }

  console.log(`\n${checks - failures}/${checks} comprobaciones OK`);
  await sql.end();
  if (failures > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await sql.end().catch((e) => console.error(e));
  process.exit(1);
});
