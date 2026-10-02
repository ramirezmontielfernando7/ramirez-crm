/**
 * Self-test E2E de Campañas v2, PR 2 — audiencias .xlsx/.csv, asistente de 3
 * pasos, cola por número, pausa/reanudación/cancelación, programación,
 * prueba a un número propio, pausa de seguridad automática con su aviso, y
 * el Asesor sin acceso (tests/e2e/us-campanas-v2.md).
 *
 * Conduce la app REAL contra la BD de verdad y el wa-mock: lo que Meta
 * recibe se comprueba en el outbox del mock, no se supone.
 *
 * Uso:
 *   1) app con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock, el módulo
 *      Campañas encendido para la organización y la BD migrada
 *   2) node --env-file=.env scripts/e2e-campanas-v2.mjs
 *
 * Re-ejecutable: cada corrida usa plantilla, bases y teléfonos nuevos.
 * Sale con 1 si algo falla.
 */
import { strToU8, zipSync } from "fflate";
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const R3 = RUN.slice(-3);

let failures = 0;
let checks = 0;
function ok(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${String(extra).slice(0, 600)}` : ""}`);
  }
}

function cliente() {
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
    let text = null;
    try {
      text = await res.clone().text();
      json = JSON.parse(text);
    } catch {}
    return { res, json, text };
  }
  return { api, cookie: () => cookie };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 30000, paso = 400) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}

/** Un .xlsx mínimo (una hoja, todo texto), como lo guarda Excel. */
function xlsx(rows, extraFiles = {}) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const col = (j) => String.fromCharCode(65 + j);
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map((r, i) => `<row r="${i + 1}">${r.map((c, j) => `<c r="${col(j)}${i + 1}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`).join("")}</row>`)
    .join("")}</sheetData></worksheet>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Base" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
    ...extraFiles,
  });
}

function fileForm(name, bytes, fields = {}) {
  const form = new FormData();
  form.set("file", new Blob([bytes]), name);
  for (const [k, v] of Object.entries(fields)) form.set(k, typeof v === "string" ? v : JSON.stringify(v));
  return form;
}

/**
 * 13 dígitos, únicos por corrida: 52 + p(2) + RUN(4) + sufijo(5). `p` entre
 * 20 y 99: un "521…" de 13 dígitos el CRM lo normaliza a 52… (normalizeMx).
 */
const num = (p, suffix) => {
  if (p < 20 || p > 99) throw new Error(`num(${p}): usa 20..99`);
  return `52${p}${RUN.slice(-4)}${suffix}`;
};

async function outboxTo(api, tplName) {
  const all = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  return all.filter((m) => m.type === "template" && m.body?.template?.name === tplName).map((m) => m.to);
}

async function campaign(api, id) {
  return (await api(`/api/campaigns/${id}`)).json?.campaign;
}

async function main() {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`La app no responde en ${BASE}`);
    process.exit(1);
  }
  const owner = cliente();
  const api = owner.api;

  console.log("== Setup: login + WhatsApp (wa-mock) + plantilla aprobada ==");
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name: "Operador E2E" }) });
  if (!su.res.ok) su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  ok("login del propietario", su.res.ok, su.text);
  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-E2E", phoneNumberId: "PN-E2E", token: "tok-e2e" }),
  });
  ok("WhatsApp conectado", conn.res.ok, conn.text);
  const list = await api("/api/campaigns");
  if (list.res.status === 404) {
    console.error("El módulo Campañas está apagado para esta organización: enciéndelo (CAMPAIGNS=on o /platform).");
    process.exit(1);
  }
  await api("/api/campaigns/settings", {
    method: "PUT",
    body: JSON.stringify({
      failRatePercent: 20,
      failRateWindow: 50,
      pauseOnQualityRed: true,
      usagePausePercent: 95,
      rates: {},
      currency: null,
      replyWindowHours: 72,
    }),
  });
  const tplName = `cupon_${RUN}`;
  const tpl = await api("/api/templates", {
    method: "POST",
    body: JSON.stringify({ name: tplName, language: "es_MX", category: "MARKETING", body: "Hola {{1}}, tu cupón es {{2}}." }),
  });
  ok("plantilla creada", tpl.res.status === 201, tpl.text);
  const tplId = tpl.json?.template?.id;
  await api("/api/dev/wa-mock/template-status", {
    method: "POST",
    body: JSON.stringify({ wabaId: "WABA-E2E", name: tplName, language: "es_MX", event: "APPROVED", notify: false }),
  });
  ok("sincronizada y aprobada", (await api("/api/templates/sync", { method: "POST" })).res.ok);

  /* ------------------------------------------------------------ */
  console.log("\n== 1. Audiencias: archivo, columnas, vista previa ==");
  const ana = num(31, "10001");
  const beto = num(32, "10002");
  const rows = [
    ["Persona", "Móvil 1", "Mail", "Cupón"],
    ["Ana E2E", ana, "ana@e2e.mx", "A10"],
    ["Beto E2E", beto, "beto@e2e.mx", "B20"],
    ["=cmd|' /C calc'!A0", "123", "", ""],
    ["Ana repetida", ana, "", ""],
    ["Sin cupón", num(33, "10003"), "", ""],
  ];
  const bytes = xlsx(rows);
  const p1 = await api("/api/campaigns/audiences/preview", { method: "POST", body: fileForm(`base-${RUN}.xlsx`, bytes) });
  ok(
    "encabezados desconocidos: pide «¿qué es cada columna?»",
    p1.res.ok && JSON.stringify(p1.json?.preview?.missing) === JSON.stringify(["name", "phone"]) && p1.json?.preview?.summary === null,
    p1.text
  );
  const mapping = { name: 0, phone: 1, email: 2 };
  const p2 = await api("/api/campaigns/audiences/preview", { method: "POST", body: fileForm(`base-${RUN}.xlsx`, bytes, { mapping }) });
  const s2 = p2.json?.preview?.summary;
  ok("con columnas asignadas: 3 válidas, 1 inválida, 1 duplicada", s2?.valid === 3 && s2?.invalid === 1 && s2?.duplicate === 1, p2.text);
  ok("la fila inválida viene marcada con motivo", (p2.json?.preview?.sample ?? []).some((r) => r.line === 4 && /dígitos/.test(r.error ?? "")), p2.text);
  ok("«Cupón» queda como columna para variables", JSON.stringify(p2.json?.preview?.extraColumns) === JSON.stringify(["Cupón"]), p2.text);

  const macro = await api("/api/campaigns/audiences/preview", {
    method: "POST",
    body: fileForm("macro.xlsx", xlsx([["nombre", "numero"]], { "xl/vbaProject.bin": new Uint8Array([1, 2, 3]) })),
  });
  ok("un Excel con macros → 415", macro.res.status === 415 && macro.json?.error?.code === "macros", macro.text);
  const xlsm = await api("/api/campaigns/audiences/preview", { method: "POST", body: fileForm("base.xlsm", bytes) });
  ok(".xlsm → 415", xlsm.res.status === 415, xlsm.text);
  const pdf = await api("/api/campaigns/audiences/preview", { method: "POST", body: fileForm("base.pdf", strToU8("x")) });
  ok("otro formato → 415", pdf.res.status === 415, pdf.text);

  const noDecl = await api("/api/campaigns/audiences", {
    method: "POST",
    body: fileForm(`base-${RUN}.xlsx`, bytes, { mapping, consentAnswer: "" }),
  });
  ok("sin responder la pregunta de consentimiento → 422", noDecl.res.status === 422 && noDecl.json?.error?.code === "consent_required", noDecl.text);
  const imp = await api("/api/campaigns/audiences", {
    method: "POST",
    body: fileForm(`base-${RUN}.xlsx`, bytes, { mapping, name: `Base ${RUN}`, consentAnswer: "yes" }),
  });
  const aud = imp.json?.audience;
  ok("base importada → 201", imp.res.status === 201 && aud?.counts?.members === 3, imp.text);
  ok("3 pueden recibir campañas (opt_in por la declaración)", aud?.consent?.optIn === 3, JSON.stringify(aud?.consent));
  ok("resumen por estado al importar", imp.json?.summary?.consent?.optIn === 3 && aud?.counts?.consentOptIn === 3, imp.text);
  ok("la base registra «declarado al importar»", aud?.consentSource === "declarado al importar", aud?.consentSource);

  // Un miembro pide la baja: la vista previa lo muestra y el tratamiento se aplica a todos.
  const miembros = (await api(`/api/contacts?tag=${aud?.tag?.id}`)).json?.contacts ?? [];
  const dadoDeBaja = miembros[0];
  await api(`/api/contacts/${dadoDeBaja?.id}`, { method: "PATCH", body: JSON.stringify({ waConsent: "opt_out" }) });
  const prevBaja = await api("/api/campaigns/audiences/preview", { method: "POST", body: fileForm(`base-${RUN}.xlsx`, bytes, { mapping }) });
  ok("vista previa: 1 con baja, con desde cuándo", prevBaja.json?.preview?.optOut?.count === 1 && !!prevBaja.json?.preview?.optOut?.rows?.[0]?.since, prevBaja.text);
  const respeta = await api("/api/campaigns/audiences", {
    method: "POST",
    body: fileForm(`base-${RUN}.xlsx`, bytes, { mapping, name: `Base ${RUN} b`, consentAnswer: "yes", optOutTreatment: "respect" }),
  });
  ok("respetar: 2 aceptan, 1 baja", respeta.json?.summary?.consent?.optIn === 2 && respeta.json?.summary?.consent?.optOut === 1, respeta.text);
  const limbo = await api("/api/campaigns/audiences", {
    method: "POST",
    body: fileForm(`base-${RUN}.xlsx`, bytes, { mapping, name: `Base ${RUN} c`, consentAnswer: "yes", optOutTreatment: "desconocido" }),
  });
  ok("a sin confirmar: 1 pasa a desconocido", limbo.json?.summary?.consent?.toUnknown === 1 && limbo.json?.summary?.consent?.unknown === 1, limbo.text);
  await api(`/api/contacts/${dadoDeBaja?.id}`, { method: "PATCH", body: JSON.stringify({ waConsent: "opt_in" }) });
  const fails = await api(`/api/campaigns/audiences/${aud?.id}/failures`);
  ok("descarga de filas con error (CSV)", fails.res.ok && /linea,nombre,numero,motivo/.test(fails.text ?? ""), fails.text);
  ok("protegida contra fórmulas", (fails.text ?? "").includes("'=cmd"), fails.text);
  const sx = await api("/api/campaigns/audiences/sample?format=xlsx");
  ok("archivo de ejemplo .xlsx", sx.res.ok && /spreadsheetml/.test(sx.res.headers.get("content-type") ?? ""));
  const sc = await api("/api/campaigns/audiences/sample?format=csv");
  ok("archivo de ejemplo .csv", sc.res.ok && /nombre,numero,correo,etiquetas/.test(sc.text ?? ""), sc.text);

  /* ------------------------------------------------------------ */
  console.log("\n== 2. Revisar: excluidos, costo estimado, margen ==");
  const variables = [{ kind: "contact_name" }, { kind: "column", column: "Cupón" }];
  const prev = await api("/api/campaigns/preview", {
    method: "POST",
    body: JSON.stringify({ audience: { importId: aud?.id }, templateId: tplId, variables }),
  });
  const pv = prev.json?.preview;
  ok(
    "2 recibirán; excluidos: 1 sin valor de variable, 1 inválido, 1 duplicado",
    pv?.eligible === 2 && pv?.excluded?.missingVariable === 1 && pv?.excluded?.invalid === 1 && pv?.excluded?.duplicate === 1,
    prev.text
  );
  ok("sin tarifa capturada no hay costo estimado", pv?.estimate === null, prev.text);
  await api("/api/campaigns/settings", {
    method: "PUT",
    body: JSON.stringify({
      failRatePercent: 20,
      failRateWindow: 50,
      pauseOnQualityRed: true,
      usagePausePercent: 95,
      rates: { marketing: 0.5 },
      currency: "MXN",
      replyWindowHours: 72,
    }),
  });
  const prev2 = (
    await api("/api/campaigns/preview", {
      method: "POST",
      body: JSON.stringify({ audience: { importId: aud?.id }, templateId: tplId, variables }),
    })
  ).json?.preview;
  ok("con tarifa: 2 × 0.5 = 1 MXN estimado", prev2?.estimate?.amount === 1 && prev2?.estimate?.currency === "MXN", JSON.stringify(prev2));
  ok("la zona horaria del negocio viaja para programar", typeof prev2?.timezone === "string" && prev2.timezone.length > 0);

  /* ------------------------------------------------------------ */
  console.log("\n== 3. Prueba a un número propio, enviar, variables desde columnas ==");
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  const c1 = await api("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({ name: `Cupones ${RUN}`, templateId: tplId, variables, audience: { importId: aud?.id } }),
  });
  ok("borrador creado", c1.res.status === 201, c1.text);
  const id1 = c1.json?.campaign?.id;
  const mine = num(39, "19999");
  const test = await api(`/api/campaigns/${id1}/test`, { method: "POST", body: JSON.stringify({ phone: mine }) });
  ok("prueba enviada", test.res.ok, test.text);
  const test2 = await api(`/api/campaigns/${id1}/test`, { method: "POST", body: JSON.stringify({ phone: mine }) });
  ok("otra prueba seguida → 429", test2.res.status === 429, test2.text);
  const outTest = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  const testMsg = outTest.find((m) => m.to === mine && m.body?.template?.name === tplName);
  ok(
    "la prueba lleva las variables de un destinatario real",
    JSON.stringify(testMsg?.body?.template?.components?.[0]?.parameters?.map((x) => x.text)) === JSON.stringify(["Prueba", "A10"]),
    JSON.stringify(testMsg?.body?.template)
  );
  ok("la prueba no cuenta en la campaña", (await campaign(api, id1))?.total === 0);

  const send = await api(`/api/campaigns/${id1}/send`, { method: "POST" });
  ok("enviar → 202", send.res.status === 202, send.text);
  let final1;
  const done1 = await hasta(async () => {
    final1 = await campaign(api, id1);
    return final1?.status === "completed";
  });
  ok("terminó", done1, JSON.stringify(final1));
  ok("2 enviados; excluidos guardados; costo estimado", final1?.counts?.sent === 2 && final1?.excluded?.missingVariable === 1 && final1?.estimatedCost === 1, JSON.stringify(final1));
  const out1 = (await api("/api/dev/wa-mock/outbox")).json?.outbox ?? [];
  const anaMsg = out1.find((m) => m.to === ana && m.body?.template?.name === tplName);
  ok(
    "{{1}} = nombre, {{2}} = columna «Cupón»",
    JSON.stringify(anaMsg?.body?.template?.components?.[0]?.parameters?.map((x) => x.text)) === JSON.stringify(["Ana", "A10"]),
    JSON.stringify(anaMsg?.body?.template)
  );

  /* ------------------------------------------------------------ */
  console.log("\n== 4. Pausar a mitad, reanudar sin duplicar ==");
  const slow = Array.from({ length: 8 }, (_, i) => num(20 + i, "55500")); // wa-mock tarda 700 ms
  const slowImp = await api("/api/campaigns/audiences", {
    method: "POST",
    body: fileForm(`lentos-${RUN}.csv`, strToU8(["nombre,numero", ...slow.map((n, i) => `Lento ${i},${n}`)].join("\n")), {
      consentAnswer: "yes",
    }),
  });
  ok("base de 8 importada (csv, columnas reconocidas)", slowImp.json?.audience?.counts?.members === 8, slowImp.text);
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  const c2 = await api("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({
      name: `Lenta ${RUN}`,
      templateId: tplId,
      variables: [{ kind: "contact_name" }, { kind: "fixed", value: "LENTO" }],
      audience: { importId: slowImp.json?.audience?.id },
    }),
  });
  const id2 = c2.json?.campaign?.id;
  await api(`/api/campaigns/${id2}/send`, { method: "POST" });
  await hasta(async () => ((await outboxTo(api, tplName)).length >= 2), 20000, 100);
  const pause = await api(`/api/campaigns/${id2}/state`, { method: "POST", body: JSON.stringify({ action: "pause" }) });
  ok("pausar → en pausa", pause.res.ok && pause.json?.campaign?.status === "paused", pause.text);
  await sleep(2500); // lo que estaba en vuelo termina; nada nuevo sale
  const afterPause = (await outboxTo(api, tplName)).length;
  await sleep(2000);
  const stillPaused = await campaign(api, id2);
  ok(
    "en pausa no sale nada más",
    (await outboxTo(api, tplName)).length === afterPause && stillPaused?.counts?.pending > 0,
    JSON.stringify({ afterPause, counts: stillPaused?.counts })
  );
  const again = await api(`/api/campaigns/${id2}/state`, { method: "POST", body: JSON.stringify({ action: "pause" }) });
  ok("pausar dos veces → 409", again.res.status === 409, again.text);
  const resume = await api(`/api/campaigns/${id2}/state`, { method: "POST", body: JSON.stringify({ action: "resume" }) });
  ok("reanudar → enviando", resume.res.ok && resume.json?.campaign?.status === "sending", resume.text);
  let final2;
  const done2 = await hasta(async () => {
    final2 = await campaign(api, id2);
    return final2?.status === "completed";
  }, 40000);
  const to2 = await outboxTo(api, tplName);
  ok("reanudada termina", done2 && final2?.counts?.sent === 8, JSON.stringify(final2?.counts));
  ok("cada número recibió exactamente UNA plantilla", to2.length === 8 && new Set(to2).size === 8, JSON.stringify(to2));

  /* ------------------------------------------------------------ */
  console.log("\n== 5. Programar, pausar, cancelar ==");
  const c3 = await api("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({ name: `Programada ${RUN}`, templateId: tplId, variables, audience: { importId: aud?.id } }),
  });
  const id3 = c3.json?.campaign?.id;
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const sch = await api(`/api/campaigns/${id3}/send`, { method: "POST", body: JSON.stringify({ scheduledLocal: { date: tomorrow, time: "09:30" } }) });
  ok("programada → scheduled con hora", sch.res.status === 202 && sch.json?.campaign?.status === "scheduled" && !!sch.json?.campaign?.scheduledAt, sch.text);
  const past = await api("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({ name: `Pasada ${RUN}`, templateId: tplId, variables, audience: { importId: aud?.id } }),
  });
  const pastSend = await api(`/api/campaigns/${past.json?.campaign?.id}/send`, {
    method: "POST",
    body: JSON.stringify({ scheduledLocal: { date: "2020-01-01", time: "09:30" } }),
  });
  ok("programar en el pasado → 422", pastSend.res.status === 422, pastSend.text);
  await api(`/api/campaigns/${past.json?.campaign?.id}`, { method: "DELETE" });
  const p3 = await api(`/api/campaigns/${id3}/state`, { method: "POST", body: JSON.stringify({ action: "pause" }) });
  ok("pausar una programada", p3.json?.campaign?.status === "paused", p3.text);
  const r3 = await api(`/api/campaigns/${id3}/state`, { method: "POST", body: JSON.stringify({ action: "resume" }) });
  ok("reanudar una programada → vuelve a esperar su hora", r3.json?.campaign?.status === "scheduled", r3.text);
  const x3 = await api(`/api/campaigns/${id3}/state`, { method: "POST", body: JSON.stringify({ action: "cancel" }) });
  ok("cancelar → cancelada, nadie pendiente", x3.json?.campaign?.status === "cancelled" && x3.json?.campaign?.counts?.skipped === 2, x3.text);

  /* ------------------------------------------------------------ */
  console.log("\n== 6. Pausa de seguridad automática y su aviso ==");
  await api("/api/campaigns/settings", {
    method: "PUT",
    body: JSON.stringify({
      failRatePercent: 50,
      failRateWindow: 10,
      pauseOnQualityRed: true,
      usagePausePercent: 95,
      rates: { marketing: 0.5 },
      currency: "MXN",
      replyWindowHours: 72,
    }),
  });
  const bad = Array.from({ length: 25 }, (_, i) => num(40 + i, "13100")); // wa-mock: 131000
  const badImp = await api("/api/campaigns/audiences", {
    method: "POST",
    body: fileForm(`fallan-${RUN}.csv`, strToU8(["nombre,numero", ...bad.map((n, i) => `Falla ${i},${n}`)].join("\n")), {
      consentAnswer: "yes",
    }),
  });
  const c4 = await api("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({
      name: `Falla ${RUN}`,
      templateId: tplId,
      variables: [{ kind: "contact_name" }, { kind: "fixed", value: "X" }],
      audience: { importId: badImp.json?.audience?.id },
    }),
  });
  const id4 = c4.json?.campaign?.id;
  await api(`/api/campaigns/${id4}/send`, { method: "POST" });
  let final4;
  await hasta(async () => {
    final4 = await campaign(api, id4);
    return final4?.status === "paused";
  }, 30000);
  ok("se pausó sola por la tasa de fallos", final4?.status === "paused" && final4?.autoPaused === true, JSON.stringify(final4));
  ok("con el motivo en español", /fallaron \d+ de los últimos 10/.test(final4?.pauseReason ?? ""), final4?.pauseReason);
  ok("no quemó toda la base", (final4?.counts?.pending ?? 0) > 0, JSON.stringify(final4?.counts));
  const alerts = await api("/api/campaigns/alerts");
  ok("aparece en los avisos de la app", (alerts.json?.paused ?? []).some((p) => p.id === id4), alerts.text);

  /* ------------------------------------------------------------ */
  console.log("\n== 7. El Asesor no entra (403) ==");
  const advEmail = "asesor.campanas.e2e@vocero.test";
  const alta = await api("/api/settings/team", {
    method: "POST",
    body: JSON.stringify({ name: "Asesor Campañas E2E", email: advEmail, password, role: "asesor" }),
  });
  ok("alta del asesor", alta.res.status === 201 || alta.res.status === 409, alta.text);
  const adv = cliente();
  const login = await adv.api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: advEmail, password }) });
  ok("el asesor entra", login.res.ok, login.text);
  for (const [path, method] of [
    ["/api/campaigns", "GET"],
    ["/api/campaigns/audiences", "GET"],
    [`/api/campaigns/${id4}/state`, "POST"],
    ["/api/campaigns/settings", "GET"],
    ["/api/campaigns/audiences/sample", "GET"],
  ]) {
    const r = await adv.api(path, { method, ...(method === "POST" ? { body: JSON.stringify({ action: "resume" }) } : {}) });
    ok(`asesor ${method} ${path.replace(id4, ":id")} → 403`, r.res.status === 403, r.text);
  }

  /* ------------------------------------------------------------ */
  console.log("\n== 8. Interfaz (navegador real) ==");
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  try {
    const ctx = await browser.newContext();
    const host = new URL(BASE).hostname;
    await ctx.addCookies(
      owner.cookie().split("; ").map((c) => {
        const [n, ...v] = c.split("=");
        return { name: n, value: v.join("="), domain: host, path: "/" };
      })
    );
    const page = await ctx.newPage();
    page.on("dialog", (d) => void d.accept());

    await page.goto(`${BASE}/campaigns`, { timeout: 180000 });
    ok("pestañas Campañas / Audiencias / Métricas", await page.getByRole("navigation", { name: "Secciones de Campañas" }).isVisible());
    const banner = page.getByTestId("campaign-pause-banner");
    ok("aviso de pausa de seguridad visible", await banner.waitFor({ timeout: 45000 }).then(() => true, () => false));

    await page.goto(`${BASE}/campaigns/metrics`, { timeout: 180000 });
    ok("Métricas: la ruta existe con su aviso", await page.getByTestId("metrics-soon").waitFor({ timeout: 45000 }).then(() => true, () => false));

    // Audiencias: subir con columnas desconocidas, asignarlas, revisar e importar.
    await page.goto(`${BASE}/campaigns/audiences`, { timeout: 180000 });
    await page.getByTestId("audience-new").click();
    const uiPhones = [num(70, "10070"), num(71, "10071")];
    await page.getByTestId("audience-file").setInputFiles({
      name: `ui-${RUN}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(xlsx([["Persona", "Móvil 1", "Cupón"], ["Uri UI", uiPhones[0], "U1"], ["Vero UI", uiPhones[1], "V2"], ["Mal", "12", ""]])),
    });
    await page.getByTestId("consent-question").waitFor({ timeout: 45000 });
    ok("UI: la pregunta de consentimiento va antes de la vista previa", (await page.getByTestId("audience-mapping").count()) === 0);
    ok("UI: sin responder no se puede importar", (await page.getByTestId("audience-import").count()) === 0);
    await page.getByTestId("consent-yes").check();
    await page.getByTestId("audience-mapping").waitFor({ timeout: 45000 });
    ok("UI: pide «¿qué es cada columna?»", true);
    await page.getByTestId("map-name").selectOption("0");
    await page.getByTestId("map-phone").selectOption("1");
    await page.getByRole("button", { name: "Aplicar columnas" }).click();
    await page.getByTestId("audience-preview-table").waitFor({ timeout: 45000 });
    ok("UI: la fila inválida aparece en rojo", (await page.locator('[data-invalid="true"]').count()) === 1);
    await page.getByTestId("audience-import").click();
    await page.getByTestId("audience-result").waitFor({ timeout: 45000 });
    ok("UI: base importada con su resumen", await page.getByTestId("audience-result").getByText("Creados").isVisible());
    ok("UI: resumen por estado de consentimiento", /2\s+acepta mensajes/i.test(await page.getByTestId("consent-result").innerText()));
    const uiAud = ((await api("/api/campaigns/audiences")).json?.audiences ?? []).find((a) => a.fileName === `ui-${RUN}.xlsx`);

    // Asistente de 3 pasos desde la base recién subida.
    await page.goto(`${BASE}/campaigns/new?audience=${uiAud?.id}`, { timeout: 180000 });
    await page.getByTestId("wizard-step-audience").waitFor({ timeout: 45000 });
    await page.getByTestId("audience-preview").getByText("Le llegará a").waitFor({ timeout: 45000 });
    ok("UI paso 1: cuántos recibirán", (await page.getByTestId("audience-preview").innerText()).includes("2"));
    await page.getByTestId("wizard-next-1").click();
    await page.getByLabel("Nombre interno").fill(`UI ${RUN}`);
    await page.getByLabel("Plantilla").selectOption(tplId);
    await page.getByLabel("Tipo de {{1}}").selectOption("contact_name");
    await page.getByLabel("Tipo de {{2}}").selectOption("column");
    ok("UI paso 2: burbuja de WhatsApp con la vista previa", (await page.getByTestId("whatsapp-bubble").innerText()).includes("Hola Ana, tu cupón es [Cupón]"));
    await page.getByTestId("wizard-next-2").click();
    await page.getByTestId("review-summary").waitFor({ timeout: 45000 });
    ok("UI paso 3: costo marcado como Estimado", (await page.getByTestId("review-cost").innerText()).includes("Estimado"));
    ok("UI paso 3: margen del límite", await page.getByTestId("review-limit").isVisible());
    await page.getByTestId("test-phone").fill(num(79, "19979"));
    await page.getByTestId("test-send").click();
    await page.getByTestId("test-result").waitFor({ timeout: 45000 });
    ok("UI: prueba enviada", (await page.getByTestId("test-result").innerText()).includes("Prueba enviada"));
    await page.getByTestId("when-later").check();
    await page.getByTestId("schedule-date").fill(tomorrow);
    await page.getByTestId("schedule-time").fill("10:15");
    await page.getByTestId("wizard-confirm").click();
    await page.getByTestId("wizard-launch").click();
    await page.getByTestId("campaign-scheduled").waitFor({ timeout: 60000 });
    ok("UI: programada y en su detalle", true);
    await page.getByTestId("campaign-pause").click();
    await page.getByTestId("campaign-pause-reason").waitFor({ timeout: 45000 });
    ok("UI: pausada a mano con su motivo", (await page.getByTestId("campaign-pause-reason").innerText()).includes("Pausada a mano"));
    await page.getByTestId("campaign-cancel").click();
    await page.getByText("Cancelada", { exact: true }).waitFor({ timeout: 45000 });
    ok("UI: cancelada", true);
  } catch (err) {
    ok("interfaz sin errores", false, err?.message ?? String(err));
  } finally {
    await browser.close();
  }

  console.log(`\n${checks - failures}/${checks} verificaciones OK`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
