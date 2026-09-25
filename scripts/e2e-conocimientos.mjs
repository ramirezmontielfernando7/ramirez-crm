/**
 * Self-test E2E de 024 — Conocimientos (tests/e2e/us-conocimientos.md).
 *
 * Conduce la app REAL con los mocks y tres personas (propietario,
 * coordinadora y asesor A):
 *   - Propietario y Coordinador crean, editan y borran; el Asesor recibe 403
 *     pero ve, busca, descarga y ENVÍA;
 *   - la búsqueda encuentra por título, contenido y etiqueta, sin acentos;
 *   - un archivo subido jamás se sirve como HTML;
 *   - desde un chat: `/` abre el buscador, "Enviar texto" y "Enviar archivo"
 *     llegan al hilo, "Insertar" pone el texto en el editor;
 *   - el asesor no puede enviar a un chat que no es suyo (404).
 *
 * Uso: app viva con los mocks (`pnpm dev`), después de `pnpm test:e2e` y
 * `pnpm test:e2e:roles`:
 *   node --env-file=.env scripts/e2e-conocimientos.mjs
 * Con SHOTS_DIR=<carpeta> guarda capturas. Re-ejecutable. Sale con 1 si algo falla.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR ?? null;
const RUN = Date.now().toString().slice(-7);
const PN = "PN-E2E";
const OWNER = { email: "e2e@vocero.test", password: "password-e2e-123" };
const COORD = { email: "coord.e2e@vocero.test", password: "password-e2e-roles-123" };
const A = { email: "asesor.a.e2e@vocero.test", password: "password-e2e-roles-123" };

let fails = 0;
let checks = 0;
const ok = (n, c, x = "") => {
  checks++;
  console.log(`  ${c ? "OK  " : "FAIL"} ${n}${!c && x ? " — " + x : ""}`);
  if (!c) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 15000, paso = 300) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}

// 1×1 PNG y un PDF mínimo.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const browser = await chromium
  .launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" })
  .catch(() => chromium.launch());

async function persona(who) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.click('button[type="submit"]');
  const entro = await page.waitForURL(/inbox/, { timeout: 30000 }).then(() => true, () => false);
  const call = async (method, path, data, multipart) => {
    const res = await ctx.request.fetch(`${BASE}${path}`, {
      method,
      ...(multipart ? { multipart } : { data }),
      headers: { origin: BASE },
      maxRedirects: 0,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status(), json, headers: res.headers() };
  };
  return { ctx, page, errors, entro, call };
}

const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const owner = await persona(OWNER);
const coord = await persona(COORD);
const asesor = await persona(A);
ok("las tres personas inician sesión", owner.entro && coord.entro && asesor.entro);

/* ── 1 · Crear, permisos y búsqueda ──────────────────────────────── */
console.log("\n== 1 · Crear y permisos ==");
const envios = await owner.call("POST", "/api/knowledge", {
  title: `Política de envíos ${RUN}`,
  body: `Enviamos a todo México en 2 a 4 días hábiles. Envío gratis desde $1,500. REF-${RUN}`,
  tags: ["envíos", "políticas"],
});
ok("el Propietario crea una entrada de texto (JSON) → 201", envios.status === 201, `status=${envios.status}`);
const catalogo = await coord.call("POST", "/api/knowledge", null, {
  title: `Catálogo ${RUN}`,
  body: "Te comparto nuestro catálogo con precios vigentes.",
  tags: "catálogo, precios",
  file: { name: `catalogo-${RUN}.pdf`, mimeType: "application/pdf", buffer: PDF },
});
ok("la Coordinadora crea una entrada con PDF (multipart) → 201", catalogo.status === 201, `status=${catalogo.status}`);
ok("…con su archivo", catalogo.json?.entry?.file?.name === `catalogo-${RUN}.pdf`);
const foto = await owner.call("POST", "/api/knowledge", null, {
  title: `Foto del modelo grande ${RUN}`,
  file: { name: "modelo.png", mimeType: "image/png", buffer: PNG },
});
ok("una entrada solo con imagen → 201", foto.status === 201, `status=${foto.status}`);
const vacia = await owner.call("POST", "/api/knowledge", { title: "Sin nada" });
ok("sin texto ni archivo → 422", vacia.status === 422, `status=${vacia.status}`);

const aCrea = await asesor.call("POST", "/api/knowledge", { title: "x", body: "y" });
ok("el Asesor NO crea → 403", aCrea.status === 403, `status=${aCrea.status}`);
const aEdita = await asesor.call("PATCH", `/api/knowledge/${envios.json?.entry?.id}`, { title: "hack" });
ok("el Asesor NO edita → 403", aEdita.status === 403, `status=${aEdita.status}`);
const aBorra = await asesor.call("DELETE", `/api/knowledge/${envios.json?.entry?.id}`);
ok("el Asesor NO borra → 403", aBorra.status === 403, `status=${aBorra.status}`);

console.log("\n== 2 · Ver y buscar (todos) ==");
const lista = await asesor.call("GET", "/api/knowledge");
ok("el Asesor ve la lista → 200", lista.status === 200 && lista.json?.entries?.length >= 3);
const porContenido = await asesor.call("GET", `/api/knowledge?q=${encodeURIComponent(`REF-${RUN}`)}`);
ok("busca por contenido", porContenido.json?.entries?.length === 1 && porContenido.json.entries[0].id === envios.json?.entry?.id);
const sinAcento = await asesor.call("GET", `/api/knowledge?q=${encodeURIComponent(`politica de envios ${RUN}`)}`);
ok("busca por título sin acentos ni mayúsculas", sinAcento.json?.entries?.length === 1);
const porTag = await asesor.call("GET", `/api/knowledge?tag=${encodeURIComponent("Catálogo")}`);
ok("filtra por etiqueta", porTag.json?.entries?.some((e) => e.id === catalogo.json?.entry?.id));
ok("la lista trae las etiquetas en uso", (lista.json?.tags ?? []).includes("envíos"));
const archivo = await asesor.call("GET", `/api/knowledge/${catalogo.json?.entry?.id}/file`);
ok("el Asesor descarga el archivo → 200 PDF", archivo.status === 200 && archivo.headers["content-type"] === "application/pdf");

const html = await owner.call("POST", "/api/knowledge", null, {
  title: `Página ${RUN}`,
  file: { name: "x.html", mimeType: "text/html", buffer: Buffer.from("<script>alert(1)</script>") },
});
const htmlFile = await owner.call("GET", `/api/knowledge/${html.json?.entry?.id}/file`);
ok(
  "un HTML subido se descarga, nunca se sirve como página",
  htmlFile.headers["content-type"] === "application/octet-stream" &&
    htmlFile.headers["content-disposition"]?.startsWith("attachment") &&
    htmlFile.headers["x-content-type-options"] === "nosniff"
);
await owner.call("DELETE", `/api/knowledge/${html.json?.entry?.id}`);

console.log("\n== 3 · Editar ==");
const editada = await coord.call("PATCH", `/api/knowledge/${envios.json?.entry?.id}`, {
  title: `Política de envíos ${RUN}`,
  body: `Enviamos a todo México en 2 a 4 días hábiles. Envío gratis desde $1,500. REF-${RUN}`,
  tags: ["envíos", "políticas", "logística"],
});
ok("la Coordinadora edita → 200", editada.status === 200 && editada.json?.entry?.tags?.includes("logística"));
const quitaSinTexto = await owner.call("PATCH", `/api/knowledge/${foto.json?.entry?.id}`, { removeFile: true });
ok("quitar el único contenido → 422", quitaSinTexto.status === 422, `status=${quitaSinTexto.status}`);

/* ── 4 · Enviar desde un chat (API) ──────────────────────────────── */
console.log("\n== 4 · Enviar al cliente ==");
await owner.call("PUT", "/api/settings/whatsapp", { wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" });
const nombre = `Conocimientos ${RUN}`;
await owner.call("POST", "/api/dev/wa-mock/inbound", {
  phoneNumberId: PN,
  from: `5215566${RUN}`,
  name: nombre,
  text: "Hola, ¿hacen envíos a Monterrey? ¿Tienen catálogo?",
  waMessageId: `wamid.e2e.kn.${RUN}`,
});
let conv = null;
await hasta(async () => {
  const r = await owner.call("GET", "/api/conversations");
  conv = r.json?.conversations?.find((c) => c.contact?.name === nombre) ?? null;
  return Boolean(conv);
});
ok("la conversación existe", Boolean(conv));
await owner.call("PATCH", `/api/conversations/${conv?.id}`, { aiEnabled: false });

const ajeno = await asesor.call("POST", `/api/conversations/${conv?.id}/messages/knowledge`, {
  entryId: envios.json?.entry?.id,
  mode: "text",
});
ok("el Asesor no envía a un chat que no es suyo → 404", ajeno.status === 404, `status=${ajeno.status}`);
const team = (await owner.call("GET", "/api/settings/team")).json?.members ?? [];
const ID_A = team.find((m) => m.email === A.email)?.userId;
await owner.call("POST", "/api/assignments", { contactIds: [conv?.contact?.id], userId: ID_A });
const aTexto = await asesor.call("POST", `/api/conversations/${conv?.id}/messages/knowledge`, {
  entryId: envios.json?.entry?.id,
  mode: "text",
});
ok("asignado, el Asesor envía el texto → 201", aTexto.status === 201, `status=${aTexto.status} ${JSON.stringify(aTexto.json)}`);
const fotoTexto = await owner.call("POST", `/api/conversations/${conv?.id}/messages/knowledge`, {
  entryId: foto.json?.entry?.id,
  mode: "text",
});
ok("una entrada sin texto no se envía como texto → 422", fotoTexto.status === 422, `status=${fotoTexto.status}`);
const msgs1 = (await owner.call("GET", `/api/conversations/${conv?.id}/messages`)).json?.messages ?? [];
ok("el texto llegó al hilo", msgs1.some((m) => m.direction === "out" && m.text?.includes(`REF-${RUN}`)));

/* ── 5 · Navegador ───────────────────────────────────────────────── */
console.log("\n== 5 · Navegador ==");
const op = owner.page;
await op.goto(`${BASE}/knowledge`);
await op.getByRole("heading", { name: "Conocimientos" }).waitFor({ timeout: 15000 });
const textosNav = await op.locator("aside a").allInnerTexts();
const iC = textosNav.findIndex((t) => t.trim() === "Contactos");
ok("el menú tiene Conocimientos justo después de Contactos", iC >= 0 && textosNav[iC + 1]?.trim() === "Conocimientos", textosNav.join("|"));
await op.getByText(`Catálogo ${RUN}`).waitFor({ timeout: 10000 });
ok("la página lista las entradas", (await op.getByText(`Política de envíos ${RUN}`).count()) === 1);
await shot(op, "f2-01-lista");

// Crear desde la UI con archivo.
await op.getByRole("button", { name: "Nueva entrada" }).click();
const dlg = op.getByRole("dialog", { name: "Nueva entrada" });
await dlg.getByLabel("Título").fill(`Garantía ${RUN}`);
await dlg.getByLabel("Contenido").fill("Todos nuestros equipos tienen 12 meses de garantía directa con nosotros.");
await dlg.getByLabel("Etiquetas (opcional)").fill("garantía, políticas");
await dlg.getByLabel("Archivo de la entrada").setInputFiles({ name: "garantia.pdf", mimeType: "application/pdf", buffer: PDF });
await shot(op, "f2-02-nueva-entrada");
await dlg.getByRole("button", { name: "Crear entrada" }).click();
await op.getByText(`Garantía ${RUN}`).waitFor({ timeout: 10000 }).catch(() => {});
ok("crear desde la UI la agrega a la lista", (await op.getByText(`Garantía ${RUN}`).count()) === 1);

// Buscar desde la UI.
await op.getByLabel("Buscar en Conocimientos").fill(`garantia ${RUN}`);
await hasta(async () => (await op.getByText(`Catálogo ${RUN}`).count()) === 0, 5000);
ok("la búsqueda de la página filtra", (await op.getByText(`Garantía ${RUN}`).count()) === 1 && (await op.getByText(`Catálogo ${RUN}`).count()) === 0);
await shot(op, "f2-03-busqueda");
await op.getByLabel("Buscar en Conocimientos").fill("");

// El Asesor: ve, no edita.
const ap = asesor.page;
await ap.goto(`${BASE}/knowledge`);
await ap.getByText(`Catálogo ${RUN}`).waitFor({ timeout: 15000 });
ok("el Asesor ve la página", (await ap.getByText(`Catálogo ${RUN}`).count()) === 1);
ok("…sin «Nueva entrada» ni editar/borrar",
  (await ap.getByRole("button", { name: "Nueva entrada" }).count()) === 0 &&
  (await ap.getByRole("button", { name: /^(Editar|Borrar) / }).count()) === 0);
await shot(ap, "f2-04-asesor");

// Desde el chat, como el Asesor (el chat ya es suyo).
await ap.goto(`${BASE}/inbox`);
await ap.getByText(nombre).first().click();
const ta = ap.locator("textarea[placeholder^='Escribe una respuesta']");
await ta.waitFor({ timeout: 15000 });
await ta.click();
await ap.keyboard.type("/");
const picker = ap.getByRole("dialog", { name: "Conocimientos" });
await picker.waitFor({ timeout: 5000 }).catch(() => {});
ok("«/» en el editor vacío abre Conocimientos", (await picker.count()) === 1);
ok("…y el «/» no queda escrito", (await ta.inputValue()) === "");
await picker.getByLabel("Buscar en Conocimientos").fill(`catalogo ${RUN}`);
// En `pnpm dev` el primer envío de un adjunto compila rutas (hasta ~20 s).
await picker.getByText(`Catálogo ${RUN}`).waitFor({ timeout: 20000 });
await shot(ap, "f2-05-slash-buscar");
await picker.getByRole("button", { name: "Enviar archivo" }).click();
await hasta(async () => (await ap.getByRole("dialog", { name: "Conocimientos" }).count()) === 0, 40000);
const msgs2 = (await owner.call("GET", `/api/conversations/${conv?.id}/messages`)).json?.messages ?? [];
const doc = msgs2.find((m) => m.direction === "out" && m.media && m.type === "document");
ok("«Enviar archivo» manda el PDF al cliente", Boolean(doc), JSON.stringify(msgs2.map((m) => [m.type, m.status])));
ok("…con el texto como pie", doc?.media?.caption === "Te comparto nuestro catálogo con precios vigentes.", JSON.stringify(doc?.media));
await ap.getByText(`catalogo-${RUN}.pdf`).first().waitFor({ timeout: 10000 }).catch(() => {});
ok("…y se ve en el hilo", (await ap.getByText(`catalogo-${RUN}.pdf`).count()) >= 1);

// Botón de libro + Insertar.
await ap.getByRole("button", { name: "Conocimientos", exact: true }).click();
await picker.getByLabel("Buscar en Conocimientos").fill(`garantia ${RUN}`);
await picker.getByText(`Garantía ${RUN}`).waitFor({ timeout: 20000 });
await picker.getByRole("button", { name: "Insertar" }).click();
ok("«Insertar» pone el texto en el editor para revisarlo", (await ta.inputValue()).startsWith("Todos nuestros equipos tienen 12 meses"));
await shot(ap, "f2-06-insertado");
await ta.fill("");

// Enviar texto desde el picker.
await ap.getByRole("button", { name: "Conocimientos", exact: true }).click();
await picker.getByLabel("Buscar en Conocimientos").fill(`garantia ${RUN}`);
await picker.getByText(`Garantía ${RUN}`).waitFor({ timeout: 20000 });
await picker.getByRole("button", { name: "Enviar texto" }).click();
await hasta(async () => (await ap.getByRole("dialog", { name: "Conocimientos" }).count()) === 0, 20000);
await ap.getByText("Todos nuestros equipos tienen 12 meses").first().waitFor({ timeout: 10000 }).catch(() => {});
ok("«Enviar texto» llega al hilo", (await ap.getByText("Todos nuestros equipos tienen 12 meses").count()) >= 1);
await shot(ap, "f2-07-enviado");

// Escape cierra.
await ta.click();
await ap.keyboard.type("/");
await picker.waitFor({ timeout: 5000 });
await ap.keyboard.press("Escape");
ok("Esc cierra el buscador", (await ap.getByRole("dialog", { name: "Conocimientos" }).count()) === 0);

/* ── 6 · Borrar ──────────────────────────────────────────────────── */
console.log("\n== 6 · Borrar ==");
await op.goto(`${BASE}/knowledge`);
await op.getByText(`Garantía ${RUN}`).waitFor({ timeout: 10000 });
op.once("dialog", (d) => void d.accept());
await op.getByRole("button", { name: `Borrar Garantía ${RUN}` }).click();
await hasta(async () => (await op.getByText(`Garantía ${RUN}`).count()) === 0, 5000);
ok("borrar desde la UI la quita", (await op.getByText(`Garantía ${RUN}`).count()) === 0);
for (const e of [envios, catalogo, foto]) {
  const r = await coord.call("DELETE", `/api/knowledge/${e.json?.entry?.id}`);
  ok(`la Coordinadora borra «${e.json?.entry?.title}» → 204`, r.status === 204, `status=${r.status}`);
}
const yaNo = await owner.call("GET", `/api/knowledge/${catalogo.json?.entry?.id}/file`);
ok("el archivo borrado ya no se sirve → 404", yaNo.status === 404, `status=${yaNo.status}`);

ok("sin errores de página", [owner, coord, asesor].every((p) => p.errors.length === 0),
  [owner, coord, asesor].flatMap((p) => p.errors).join(" | "));

await browser.close();
console.log(`\n===== ${checks - fails}/${checks} checks OK, ${fails} fallos =====`);
process.exit(fails > 0 ? 1 : 0);
