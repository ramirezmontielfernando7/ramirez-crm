/**
 * Self-test E2E de 021 — etiquetas, consentimiento, importar/exportar CSV y
 * campañas de envío masivo (tests/e2e/us-campanas.md).
 *
 * Conduce la app REAL contra la BD de verdad y el wa-mock: lo que Meta
 * recibe se comprueba en el outbox del mock, no se supone.
 *
 * Uso:
 *   1) app corriendo con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock,
 *      CAMPAIGNS=on, CAMPAIGN_BACKOFF_SCALE=0.01 y BD migrada
 *   2) node --env-file=.env scripts/e2e-campanas.mjs
 *
 * Re-ejecutable: cada corrida usa etiquetas, plantilla y teléfonos nuevos.
 * Sale con 1 si algo falla.
 */

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const RUN = Date.now().toString().slice(-7);
const R3 = RUN.slice(0, 3);

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 30000, paso = 400) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}

function csvFile(name, content, type = "text/csv") {
  const form = new FormData();
  form.set("file", new Blob([content], { type }), name);
  return form;
}

/** 13 dígitos: 521 + 55 + RUN(7) + n. */
const tel = (n) => `52155${RUN}${n}`;
/** El número tal como lo guarda y lo manda el CRM (normalizeMx 521→52). */
const norm = (p) => (p.startsWith("521") && p.length === 13 ? `52${p.slice(3)}` : p);

const PHONES = {
  ana: tel(1),
  sinWa: `52155${R3}00000`, // wa-mock: 131026, no tiene WhatsApp
  limite: `52155${R3}42900`, // wa-mock: 130429 la primera vez
  dani: tel(4),
  eva: tel(5),
};

async function main() {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`La app no responde en ${BASE}`);
    process.exit(1);
  }

  console.log("== Setup: login + WhatsApp (wa-mock) ==");
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador E2E" }),
  });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  }
  ok("login del propietario", su.res.ok, JSON.stringify(su.json));
  const conn = await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-E2E", phoneNumberId: "PN-E2E", token: "tok-e2e" }),
  });
  ok("WhatsApp conectado", conn.res.ok, JSON.stringify(conn.json));

  console.log("== 1. Etiquetas ==");
  const vip = await api("/api/contact-tags", {
    method: "POST",
    body: JSON.stringify({ name: `VIP ${RUN}`, color: "verde" }),
  });
  ok("crear etiqueta → 201", vip.res.status === 201, vip.text);
  const vipId = vip.json?.tag?.id;
  const dup = await api("/api/contact-tags", { method: "POST", body: JSON.stringify({ name: `  VIP   ${RUN} ` }) });
  ok("duplicada (normalizada) → 409", dup.res.status === 409, dup.text);
  const empty = await api("/api/contact-tags", { method: "POST", body: JSON.stringify({ name: "   " }) });
  ok("nombre vacío → 422", empty.res.status === 422, empty.text);
  const ren = await api(`/api/contact-tags/${vipId}`, {
    method: "PATCH",
    body: JSON.stringify({ name: `Clientes VIP ${RUN}` }),
  });
  ok("renombrar", ren.res.ok && ren.json?.tag?.name === `Clientes VIP ${RUN}`, ren.text);

  console.log("== 2. Importar CSV ==");
  const fileName = `clientes-${RUN}.csv`;
  const csv =
    "﻿Nombre;Teléfono;Fuente;Consentimiento;Origen consentimiento;Etiquetas\r\n" +
    `ANA LÓPEZ;+52 1 55 ${RUN.slice(0, 4)} ${RUN.slice(4)}1;referido;opt_in;Formulario web;Clientes VIP ${RUN}, Promo ${RUN}\r\n` +
    `Sin WhatsApp;${PHONES.sinWa};;si;Mostrador;Clientes VIP ${RUN}\r\n` +
    `Beto Límite;${PHONES.limite};anuncio;opt_in;;Clientes VIP ${RUN}\r\n` +
    ";;;;;\r\n" +
    `Dani Desconocido;${PHONES.dani};;;;Clientes VIP ${RUN}\r\n` +
    `Eva Baja;${PHONES.eva};;opt_out;Pidió no recibir;Clientes VIP ${RUN}\r\n` +
    `Local;5512345678;;;;\r\n` +
    `Repetida;${PHONES.ana};;;;\r\n`;
  const imp = await api("/api/contacts/import", { method: "POST", body: csvFile(fileName, csv) });
  const sum = imp.json?.summary;
  ok("importación → 200", imp.res.ok, imp.text);
  ok("5 creados, 0 existentes", sum?.created === 5 && sum?.updated === 0, JSON.stringify(sum));
  ok("2 no importados + 1 vacía", sum?.failed === 2 && sum?.emptyRows === 1, JSON.stringify(sum));
  const byLine = Object.fromEntries((sum?.failures ?? []).map((f) => [f.line, f.reason]));
  ok("línea 8: sin código de país", /sin código de país/.test(byLine[8] ?? ""), JSON.stringify(byLine));
  ok("línea 9: repetido de la línea 2", /repetido.*línea 2/.test(byLine[9] ?? ""), JSON.stringify(byLine));
  ok("etiqueta del import", sum?.tag?.name === `Import: ${fileName}`, JSON.stringify(sum?.tag));
  const importTagId = sum?.tag?.id;

  const tagsList = await api("/api/contact-tags");
  const promo = tagsList.json?.tags?.find((t) => t.name === `Promo ${RUN}`);
  ok("etiqueta de la columna creada", !!promo, tagsList.text);
  const vipCount = tagsList.json?.tags?.find((t) => t.id === vipId)?.contactCount;
  ok("VIP la llevan 5", vipCount === 5, String(vipCount));

  const listAll = await api(`/api/contacts?tag=${importTagId}`);
  const byName = Object.fromEntries((listAll.json?.contacts ?? []).map((c) => [c.name, c]));
  ok("filtro por etiqueta del import → 5", listAll.json?.contacts?.length === 5, listAll.text);
  ok("teléfono normalizado 521→52", byName["ANA LÓPEZ"]?.phone === norm(PHONES.ana), byName["ANA LÓPEZ"]?.phone);
  ok("sin columna de consentimiento → desconocido", byName["Dani Desconocido"]?.waConsent === "desconocido");
  ok(
    "consentimiento y origen del CSV",
    byName["ANA LÓPEZ"]?.waConsent === "opt_in" && byName["ANA LÓPEZ"]?.waConsentSource === "Formulario web"
  );
  ok("«si» cuenta como opt_in", byName["Sin WhatsApp"]?.waConsent === "opt_in");
  ok("opt_out del CSV", byName["Eva Baja"]?.waConsent === "opt_out");
  const optIn = await api(`/api/contacts?tag=${importTagId}&consent=opt_in`);
  ok("filtro por consentimiento → 3", optIn.json?.contacts?.length === 3, optIn.text);

  console.log("== 3. Errores de archivo ==");
  const noPhone = await api("/api/contacts/import", {
    method: "POST",
    body: csvFile("x.csv", "nombre,correo\nAna,a@b.c\n"),
  });
  ok("sin columna phone → 422 que la nombra", noPhone.res.status === 422 && /phone/.test(noPhone.json?.error?.message), noPhone.text);
  const xlsx = await api("/api/contacts/import", {
    method: "POST",
    body: csvFile("base.csv", new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])),
  });
  ok("xlsx disfrazado → 415 con instrucción", xlsx.res.status === 415 && /Excel/.test(xlsx.json?.error?.message), xlsx.text);
  const pdf = await api("/api/contacts/import", { method: "POST", body: csvFile("base.pdf", "x") });
  ok("extensión no CSV → 415", pdf.res.status === 415, pdf.text);
  const big = await api("/api/contacts/import", {
    method: "POST",
    body: csvFile("big.csv", "name,phone\n" + "x".repeat(5 * 1024 * 1024 + 10)),
  });
  ok("más de 5 MB → 413", big.res.status === 413, big.text?.slice(0, 200));
  const malformed = await api("/api/contacts/import", {
    method: "POST",
    body: csvFile("m.csv", 'name,phone\n"Ana,5215512345678\n'),
  });
  ok("comilla sin cerrar → 422 con línea", malformed.res.status === 422 && /línea 2/.test(malformed.json?.error?.message), malformed.text);

  console.log("== 4. Re-importar ==");
  const re = await api("/api/contacts/import", {
    method: "POST",
    body: csvFile(
      `reimport-${RUN}.csv`,
      `name,phone,waConsent\nOtro Nombre,${PHONES.eva},opt_in\nAna Nueva,${PHONES.ana},opt_in\n`
    ),
  });
  const rs = re.json?.summary;
  ok("re-import: 0 creados, 2 existentes", rs?.created === 0 && rs?.updated === 2, re.text);
  ok("aviso: opt_out conservado", (rs?.warnings ?? []).some((w) => /No quiere mensajes/.test(w.reason)), JSON.stringify(rs?.warnings));
  const eva = (await api(`/api/contacts?tag=${importTagId}&consent=opt_out`)).json?.contacts ?? [];
  ok("Eva sigue opt_out y con su nombre", eva.length === 1 && eva[0].name === "Eva Baja", JSON.stringify(eva));

  console.log("== 5. Exportar ==");
  const exp = await api(`/api/contacts/export?tag=${importTagId}&consent=opt_in`);
  ok("export → text/csv", exp.res.ok && /text\/csv/.test(exp.res.headers.get("content-type") ?? ""), exp.text?.slice(0, 200));
  const lines = (exp.text ?? "").replace(/^﻿/, "").trim().split(/\r\n/);
  ok("export respeta filtros: cabecera + 3", lines.length === 4, String(lines.length));
  ok("cabecera re-importable", lines[0]?.startsWith("name,phone,source,waConsent,waConsentSource,tags"), lines[0]);
  const anaLine = lines.find((l) => l.startsWith("ANA LÓPEZ"));
  ok("tags concatenados y consentimiento", !!anaLine && anaLine.includes("opt_in") && anaLine.includes(`Promo ${RUN}`), anaLine);
  const reExp = await api("/api/contacts/import", { method: "POST", body: csvFile(`export-${RUN}.csv`, exp.text) });
  ok("el export se re-importa sin errores", reExp.json?.summary?.failed === 0 && reExp.json?.summary?.updated === 3, reExp.text);
  const badFilter = await api("/api/contacts/export?consent=quiza");
  ok("filtro inválido → 422", badFilter.res.status === 422, badFilter.text);

  console.log("== 6. Plantilla ==");
  const tplName = `promo_${RUN}`;
  const tpl = await api("/api/templates", {
    method: "POST",
    body: JSON.stringify({
      name: tplName,
      language: "es_MX",
      category: "MARKETING",
      body: "Hola {{1}}, esta semana tenemos {{2}} en todos los servicios.",
    }),
  });
  ok("plantilla creada (pendiente)", tpl.res.status === 201, tpl.text);
  const tplId = tpl.json?.template?.id;
  const pend = await api("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({ name: "x", templateId: tplId, variables: [], audience: {} }),
  });
  ok("plantilla pendiente → 422", pend.res.status === 422 && pend.json?.error?.code === "template_not_approved", pend.text);
  await api("/api/dev/wa-mock/template-status", {
    method: "POST",
    body: JSON.stringify({ wabaId: "WABA-E2E", name: tplName, language: "es_MX", event: "APPROVED", notify: false }),
  });
  const sync = await api("/api/templates/sync", { method: "POST" });
  ok("sync con Meta", sync.res.ok, sync.text);

  console.log("== 7. Público ==");
  const audience = { tagIds: [importTagId] };
  const prev = await api("/api/campaigns/preview", { method: "POST", body: JSON.stringify({ audience }) });
  const p = prev.json?.preview;
  ok("3 elegibles, 2 sin consentimiento (1 opt_out)", p?.eligible === 3 && p?.withoutConsent === 2 && p?.optedOut === 1, prev.text);
  const sneaky = await api("/api/campaigns/preview", {
    method: "POST",
    body: JSON.stringify({ audience: { ...audience, consent: "desconocido" } }),
  });
  ok("pedir otro consentimiento → 422", sneaky.res.status === 422, sneaky.text);

  console.log("== 8. Enviar ==");
  await api("/api/dev/wa-mock/outbox", { method: "DELETE" });
  const badVars = await api("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({ name: "x", templateId: tplId, variables: [{ kind: "contact_name" }], audience }),
  });
  ok("variables mal contadas → 422", badVars.res.status === 422, badVars.text);
  const created = await api("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({
      name: `Promo ${RUN}`,
      templateId: tplId,
      variables: [{ kind: "contact_name" }, { kind: "fixed", value: "2x1" }],
      audience,
    }),
  });
  ok("borrador creado", created.res.status === 201 && created.json?.campaign?.status === "draft", created.text);
  const cmpId = created.json?.campaign?.id;
  const [send1, send2] = await Promise.all([
    api(`/api/campaigns/${cmpId}/send`, { method: "POST" }),
    api(`/api/campaigns/${cmpId}/send`, { method: "POST" }),
  ]);
  const statuses = [send1.res.status, send2.res.status].sort();
  ok("doble envío simultáneo: uno 202, otro 409", statuses[0] === 202 && statuses[1] === 409, `${statuses} ${send1.text} ${send2.text}`);

  console.log("== 9. Resultado ==");
  let final = null;
  const done = await hasta(async () => {
    final = (await api(`/api/campaigns/${cmpId}`)).json?.campaign;
    return final && final.status !== "sending";
  });
  ok("terminó", done && final?.status === "completed", JSON.stringify(final));
  ok("total 3: 2 enviados, 1 fallido", final?.total === 3 && final?.counts?.sent === 2 && final?.counts?.failed === 1, JSON.stringify(final?.counts));
  const outbox = ((await api("/api/dev/wa-mock/outbox")).json?.outbox ?? []).filter(
    (m) => m.type === "template" && m.body?.template?.name === tplName
  );
  const to = outbox.map((m) => m.to).sort();
  ok("Meta recibió exactamente 2 plantillas", outbox.length === 2, JSON.stringify(to));
  ok("a Ana y a Beto (tras el límite de Meta)", to.includes(norm(PHONES.ana)) && to.includes(norm(PHONES.limite)), JSON.stringify(to));
  ok("ninguna a desconocido ni opt_out", !to.includes(norm(PHONES.dani)) && !to.includes(norm(PHONES.eva)));
  const anaMsg = outbox.find((m) => m.to === norm(PHONES.ana));
  const params = anaMsg?.body?.template?.components?.[0]?.parameters?.map((x) => x.text);
  ok("{{1}} = nombre de pila, {{2}} = texto fijo", JSON.stringify(params) === JSON.stringify(["Ana", "2x1"]), JSON.stringify(params));
  const convs = (await api("/api/conversations")).json?.conversations ?? [];
  ok("el mensaje aparece en la Bandeja", convs.some((c) => c.contact?.phone === norm(PHONES.ana)), String(convs.length));

  console.log("== 10. Log ==");
  const failed = await api(`/api/campaigns/${cmpId}/recipients?status=failed`);
  const f = failed.json?.recipients ?? [];
  ok("fallido con motivo legible", f.length === 1 && /no tiene WhatsApp/.test(f[0].errorMessage ?? ""), failed.text);
  const logCsv = await api(`/api/campaigns/${cmpId}/recipients?format=csv`);
  ok("log en CSV (cabecera + 3)", logCsv.res.ok && (logCsv.text ?? "").trim().split(/\r\n/).length === 4, logCsv.text);

  console.log("== 11. Sin consentimiento, sin envío ==");
  const lonely = await api("/api/contact-tags", { method: "POST", body: JSON.stringify({ name: `Sin consentimiento ${RUN}` }) });
  const lonelyId = lonely.json?.tag?.id;
  const put = await api(`/api/contacts/${byName["Dani Desconocido"]?.id}/tags`, {
    method: "PUT",
    // PUT deja EXACTAMENTE estas etiquetas: se conserva la del import.
    body: JSON.stringify({ tagIds: [importTagId, lonelyId] }),
  });
  ok("etiquetar a un contacto", put.res.ok && put.json?.tags?.length === 2, put.text);
  const draft = await api("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({
      name: "Nadie",
      templateId: tplId,
      variables: [{ kind: "contact_name" }, { kind: "fixed", value: "x" }],
      audience: { tagIds: [lonelyId] },
    }),
  });
  const draftId = draft.json?.campaign?.id;
  const noRec = await api(`/api/campaigns/${draftId}/send`, { method: "POST" });
  ok("público sin opt_in → 422 no_recipients", noRec.res.status === 422 && noRec.json?.error?.code === "no_recipients", noRec.text);
  const stillDraft = (await api(`/api/campaigns/${draftId}`)).json?.campaign?.status;
  ok("queda en borrador", stillDraft === "draft", stillDraft);
  const delDraft = await api(`/api/campaigns/${draftId}`, { method: "DELETE" });
  ok("borrar borrador → 204", delDraft.res.status === 204, delDraft.text);
  const delSent = await api(`/api/campaigns/${cmpId}`, { method: "DELETE" });
  ok("borrar campaña enviada → 409", delSent.res.status === 409, delSent.text);
  const optOutNow = await api(`/api/contacts/${byName["Dani Desconocido"]?.id}`, {
    method: "PATCH",
    body: JSON.stringify({ waConsent: "opt_out" }),
  });
  ok(
    "cambio manual a opt_out queda registrado",
    optOutNow.json?.contact?.waConsent === "opt_out" && /manual/i.test(optOutNow.json?.contact?.waConsentSource ?? ""),
    optOutNow.text
  );

  console.log("== 12. Borrar etiqueta ==");
  const del = await api(`/api/contact-tags/${vipId}`, { method: "DELETE" });
  ok("borrar etiqueta → 204", del.res.status === 204, del.text);
  const after = (await api(`/api/contacts?tag=${importTagId}`)).json?.contacts ?? [];
  ok(
    "los contactos siguen, sin la etiqueta",
    after.length === 5 && after.every((c) => !(c.tags ?? []).some((t) => t.id === vipId)),
    JSON.stringify(after.map((c) => c.tags))
  );

  console.log(`\n${checks - failures}/${checks} verificaciones OK`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
