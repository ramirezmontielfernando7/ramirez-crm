/**
 * Self-test E2E de «Etiquetas limpias»: la etiqueta automática «Import: archivo»
 * es de SISTEMA (no sale en el catálogo, la cápsula de la Bandeja ni los
 * selectores; sí en Audiencias, Ajustes → «Automáticas de importación» y el
 * CSV de contactos), guardar etiquetas conserva las de sistema y la fusión
 * (con su panel de confirmación) mueve contactos, re-apunta Audiencias y no
 * admite un destino de sistema (tests/e2e/us-etiquetas-limpias.md).
 *
 * Uso: app con WA_MOCK_ENABLED=true, META_GRAPH_BASE_URL → wa-mock y Campañas
 * encendido; `node --env-file=.env scripts/e2e-etiquetas-limpias.mjs`.
 * Re-ejecutable (nombres y teléfonos nuevos por corrida). Sale con 1 si falla.
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


async function main() {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) {
    console.error(`La app no responde en ${BASE}`);
    process.exit(1);
  }
  const owner = cliente();
  const api = owner.api;
  const email = "e2e@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name: "Operador E2E" }) });
  if (!su.res.ok) su = await api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  ok("login del propietario", su.res.ok, su.text);
  await api("/api/settings/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ wabaId: "WABA-E2E", phoneNumberId: "PN-E2E", token: "tok-e2e" }),
  });
  if ((await api("/api/campaigns")).res.status === 404) {
    console.error("El módulo Campañas está apagado: enciéndelo (CAMPAIGNS=on).");
    process.exit(1);
  }

  console.log("== 1. La automática es de sistema ==");
  const finalName = `Limpia ${RUN}`;
  const file1 = `etiq-limpias-${RUN}.xlsx`;
  const p1 = [num(60, "20060"), num(61, "20061")];
  const imp = await api("/api/campaigns/audiences", {
    method: "POST",
    body: fileForm(file1, xlsx([["Persona", "Móvil"], [`Limpia A ${RUN}`, p1[0]], [`Limpia B ${RUN}`, p1[1]]]), {
      mapping: { name: 0, phone: 1 },
      consentAnswer: "yes",
      extraTagName: finalName,
      extraTagColor: "azul",
    }),
  });
  ok("importa con etiqueta propia → 201", imp.res.status === 201, imp.text);
  const autoName = `Import: ${file1}`;
  const autoId = imp.json?.audience?.tag?.id;
  ok("Audiencias sigue mostrando la automática", imp.json?.audience?.tag?.name === autoName, imp.text);
  const pub = (await api("/api/contact-tags")).json?.tags ?? [];
  ok("el catálogo público NO trae la automática", !pub.some((t) => t.name === autoName), JSON.stringify(pub.map((t) => t.name)));
  ok("…pero sí la que eligió la persona", pub.some((t) => t.name === finalName));
  const only = (await api("/api/contact-tags?system=only")).json?.tags ?? [];
  ok("?system=only lista la automática marcada", only.some((t) => t.id === autoId && t.system === true), JSON.stringify(only));
  ok("?system=only no trae etiquetas normales", only.every((t) => t.system === true));

  console.log("\n== 2. Contacto: se ve solo la elegida; guardar conserva la automática; el CSV las lleva todas ==");
  const lista = (await api(`/api/contacts?q=${encodeURIComponent(`Limpia A ${RUN}`)}`)).json;
  const c1 = (lista?.contacts ?? [])[0];
  ok("el contacto trae solo la etiqueta elegida", (c1?.tags ?? []).map((t) => t.name).join() === finalName, JSON.stringify(c1?.tags));
  const guardar = await api(`/api/contacts/${c1?.id}/tags`, { method: "PUT", body: JSON.stringify({ tagIds: [] }) });
  ok("guardar sin etiquetas visibles → 200", guardar.res.ok, guardar.text);
  const exp = await api("/api/contacts/export");
  ok("el CSV de contactos sigue llevando la automática", exp.text?.includes(autoName), exp.text?.slice(0, 200));
  await api(`/api/contacts/${c1?.id}/tags`, { method: "PUT", body: JSON.stringify({ tagIds: pub.filter((t) => t.name === finalName).map((t) => t.id) }) });

  console.log("\n== 3. Fusión: reglas (API) ==");
  const nuevaSrc = (await api("/api/contact-tags", { method: "POST", body: JSON.stringify({ name: `Vieja ${RUN}`, color: "rojo" }) })).json?.tag;
  const sys409 = await api(`/api/contact-tags/${nuevaSrc?.id}/merge`, { method: "POST", body: JSON.stringify({ targetId: autoId }) });
  ok("destino de sistema → 409", sys409.res.status === 409, sys409.text);
  const mismo = await api(`/api/contact-tags/${nuevaSrc?.id}/merge`, { method: "POST", body: JSON.stringify({ targetId: nuevaSrc?.id }) });
  ok("origen = destino → 422", mismo.res.status === 422, mismo.text);
  const ajena = await api(`/api/contact-tags/${nuevaSrc?.id}/merge`, { method: "POST", body: JSON.stringify({ targetId: "tag_de_otra_org" }) });
  ok("destino inexistente / de otra organización → 404", ajena.res.status === 404, ajena.text);
  const advEmail = "asesor.etiquetas.e2e@vocero.test";
  await api("/api/settings/team", { method: "POST", body: JSON.stringify({ name: "Asesor Etiquetas", email: advEmail, password, role: "asesor" }) });
  const adv = cliente();
  await adv.api("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email: advEmail, password }) });
  const advMerge = await adv.api(`/api/contact-tags/${nuevaSrc?.id}/merge`, { method: "POST", body: JSON.stringify({ targetId: pub[0]?.id }) });
  ok("el Asesor no fusiona → 403", advMerge.res.status === 403, advMerge.text);
  const advGet = await adv.api(`/api/contact-tags/${nuevaSrc?.id}/merge?targetId=x`);
  ok("…ni consulta el impacto → 403", advGet.res.status === 403, advGet.text);
  const del = await api(`/api/contact-tags/${nuevaSrc?.id}`, { method: "DELETE" });
  ok("limpieza de la etiqueta de prueba", del.res.status === 204);

  // Segunda base SIN etiqueta propia: su automática sí traspasa contactos al fusionar.
  const file2 = `etiq-limpias-b-${RUN}.xlsx`;
  const p2 = [num(62, "20062"), num(63, "20063")];
  const imp2 = await api("/api/campaigns/audiences", {
    method: "POST",
    body: fileForm(file2, xlsx([["Persona", "Móvil"], [`Limpia C ${RUN}`, p2[0]], [`Limpia D ${RUN}`, p2[1]]]), { mapping: { name: 0, phone: 1 }, consentAnswer: "yes" }),
  });
  ok("segunda base sin etiqueta propia → 201", imp2.res.status === 201, imp2.text);
  const auto2Name = `Import: ${file2}`;
  const auto2Id = imp2.json?.audience?.tag?.id;
  const destId = pub.find((t) => t.name === finalName)?.id;
  const sin = await api(`/api/contact-tags/${autoId}/merge?targetId=${destId}`);
  ok("impacto: los 2 de la 1.ª base ya tienen el destino (0 pasan)", sin.json?.impact?.moved === 0 && sin.json?.impact?.alreadyHad === 2, sin.text);

  console.log("\n== 4. Interfaz ==");
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

    // Bandeja: la cápsula muestra la etiqueta elegida, no la automática.
    await api("/api/dev/wa-mock/inbound", {
      method: "POST",
      body: JSON.stringify({ phoneNumberId: "PN-E2E", from: p1[0], name: `Limpia A ${RUN}`, text: "Hola", waMessageId: `wamid.e2e.limpias.${RUN}` }),
    });
    await page.goto(`${BASE}/inbox`, { timeout: 180000, waitUntil: "domcontentloaded" });
    const fila = page.locator("[data-conversation-row]", { hasText: `Limpia A ${RUN}` }).first();
    ok("UI Bandeja: aparece el chat", await fila.waitFor({ timeout: 120000 }).then(() => true, () => false));
    const cap = (await fila.getByRole("button", { name: /^Etiquetas:/ }).getAttribute("aria-label")) ?? "";
    ok("UI Bandeja: la cápsula lleva la elegida", cap.includes(finalName), cap);
    ok("UI Bandeja: y NO la automática", !cap.includes("Import:"), cap);
    const texto = (await fila.getByRole("button", { name: /^Etiquetas:/ }).innerText()).replace(/\s+/g, " ");
    ok("UI Bandeja: la primera etiqueta visible es la elegida (sin «+1»)", texto.includes(finalName) && !/\+\d/.test(texto), texto);

    // Ajustes → Etiquetas: las automáticas, plegadas, y la fusión con su confirmación.
    await page.goto(`${BASE}/settings/tags`, { timeout: 180000 });
    await page.getByTestId("system-tags").waitFor({ timeout: 60000 });
    ok("UI Ajustes: la lista pública no trae la automática", (await page.getByText(autoName, { exact: true }).count()) === 0);
    ok("UI Ajustes: sección plegada «Automáticas de importación»", (await page.getByTestId("system-tag-row").count()) === 0);
    await page.getByTestId("system-tags-toggle").click();
    const fa = page.getByTestId("system-tag-row").filter({ hasText: autoName });
    ok("UI Ajustes: al abrir se ve la automática", await fa.isVisible());
    ok("UI Ajustes: sin botón de renombrar", (await fa.getByRole("button", { name: /^Editar/ }).count()) === 0);
    const fa2 = page.getByTestId("system-tag-row").filter({ hasText: auto2Name });
    ok("UI Ajustes: también se ve la automática de la 2.ª base", await fa2.isVisible());
    await fa2.getByRole("button", { name: /^Fusionar/ }).click();
    const panel = fa2.getByTestId("tag-merge-panel");
    ok("UI fusión: «Sí, fusionar» desactivado sin destino", await panel.getByTestId("tag-merge-submit").isDisabled());
    const opciones = await panel.getByTestId("tag-merge-target").locator("option").allInnerTexts();
    ok("UI fusión: el destino solo ofrece etiquetas normales", opciones.includes(finalName) && !opciones.some((o) => o.startsWith("Import:")), opciones.join("|"));
    await panel.getByTestId("tag-merge-target").selectOption({ label: finalName });
    const conf = await panel.getByTestId("tag-merge-confirm").innerText();
    ok("UI fusión: confirmación clara (contactos, Audiencias, sin deshacer)", /2 contacto\(s\) pasarán a/.test(conf) && /Audiencias/.test(conf) && /No se puede deshacer/.test(conf), conf);
    await panel.getByTestId("tag-merge-submit").click();
    await page.getByTestId("system-tag-row").filter({ hasText: auto2Name }).waitFor({ state: "detached", timeout: 45000 }).catch(() => {});
    ok("UI fusión: la automática de la 2.ª base desapareció", (await page.getByText(auto2Name, { exact: true }).count()) === 0);
    ok("UI fusión: la de la 1.ª base sigue (no se tocó)", await page.getByTestId("system-tag-row").filter({ hasText: autoName }).isVisible());

    const dest = ((await api("/api/contact-tags")).json?.tags ?? []).find((t) => t.name === finalName);
    ok("el destino suma los 4 contactos (2 que ya tenía + 2 que pasaron)", dest?.contactCount === 4, JSON.stringify(dest));
    const auds = (await api("/api/campaigns/audiences")).json?.audiences ?? [];
    ok("Audiencias de la 2.ª base pasó a mostrar el destino (no quedó sin etiqueta)", auds.find((a) => a.fileName === file2)?.tag?.name === finalName, JSON.stringify(auds.find((a) => a.fileName === file2)));
    ok("Audiencias de la 1.ª base sigue con su automática", auds.find((a) => a.fileName === file1)?.tag?.name === autoName);
    const sinAuto2 = (await api("/api/contact-tags?system=only")).json?.tags ?? [];
    ok("la automática fusionada ya no existe", !sinAuto2.some((t) => t.id === auto2Id));
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
