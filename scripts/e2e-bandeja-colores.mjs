/**
 * Self-test E2E — Bandeja: las cápsulas usan el color que el dueño configuró.
 *
 *  1. Etiquetas con color (rojo, verde) y una sin color válido → la cápsula de
 *     la fila toma el color de la PRIMERA etiqueta (rojo), no el gris neutro.
 *  2. El color es el real que resuelve el navegador, en claro y en oscuro
 *     (cambia con el tema y no es el gris de las cápsulas de Etapa/Asignado).
 *  3. El menú de etiquetas muestra cada una con su punto de color.
 *  4. Recolorear la etiqueta en Ajustes se refleja en la Bandeja.
 *  5. Etapas: sin color elegido el punto es el de siempre (respaldo por
 *     nombre); el color se elige en «Gestionar etapas», se guarda y se ve en
 *     el punto de la cápsula y del menú de etapas; «Auto» lo quita; un color
 *     fuera de la paleta se rechaza (422).
 *  6. Móvil (390 px): cápsulas teñidas, punto de etapa con color y sin desbordar.
 *
 * Uso: app viva con WA_MOCK_ENABLED=true y los mocks.
 *   node --env-file=.env scripts/e2e-bandeja-colores.mjs
 * Con SHOTS_DIR=<carpeta> guarda capturas.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR ?? null;
const PN = "PN-E2E-1";
const RUN = Date.now().toString().slice(-7);
const ADMIN = { email: "e2e@vocero.test", password: "password-e2e-123", name: "Operador E2E" };

let failures = 0;
function ok(name, cond, extra = "") {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ver = (loc, ms = 60000) => loc.first().waitFor({ state: "visible", timeout: ms }).then(() => true, () => false);
async function hasta(cond, ms = 30000) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await Promise.resolve(cond()).catch(() => false)) return true;
    if (Date.now() > fin) return false;
    await sleep(300);
  }
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "es-MX", extraHTTPHeaders: { origin: BASE } });
const call = async (method, path, body) => {
  const res = await ctx.request.fetch(`${BASE}${path}`, { method, data: body, failOnStatusCode: false, timeout: 180000 });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // no es JSON
  }
  return { status: res.status(), json };
};
const shot = async (p, name) => {
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` });
};
const convs = async () => (await call("GET", "/api/conversations")).json?.conversations ?? [];

/** Color de fondo REAL (RGB) de un elemento, con el tema que tenga la página. */
const bg = (loc) => loc.first().evaluate((el) => getComputedStyle(el).backgroundColor);
/** Canales [r,g,b,a] de "rgb(...)"/"rgba(...)"/"color(srgb ...)". */
function canales(css) {
  const n = css.match(/[\d.]+/g)?.map(Number) ?? [];
  return n.length === 3 ? [...n, 1] : n.slice(0, 4);
}
const esRojizo = (css) => {
  const [r, g, b, a] = canales(css);
  return a > 0 && r > g + 20 && r > b + 20;
};
const esMorado = (css) => {
  const [r, g, b, a] = canales(css);
  return a > 0 && b > g + 60 && r > g + 20;
};
const esVerdoso = (css) => {
  const [r, g, b, a] = canales(css);
  return a > 0 && g > r + 10 && g > b;
};

try {
  console.log("== Setup ==");
  let login = await call("POST", "/api/auth/sign-up/email", ADMIN);
  if (login.status >= 400) login = await call("POST", "/api/auth/sign-in/email", ADMIN);
  ok("el operador entra", login.status < 400, String(login.status));
  const conn = await call("PUT", "/api/settings/whatsapp", { wabaId: "WABA-E2E", phoneNumberId: PN, token: "tok-e2e" });
  ok("número de WhatsApp conectado (wa-mock)", conn.status < 400, String(conn.status));
  await call("PUT", "/api/agent/profile", { name: "Sofi", enabled: false });

  const rojo = await call("POST", "/api/contact-tags", { name: `Urgente${RUN}`, color: "rojo" });
  const verde = await call("POST", "/api/contact-tags", { name: `Pagado${RUN}`, color: "verde" });
  const sinColor = await call("POST", "/api/contact-tags", { name: `Zeta${RUN}` });
  ok("etiquetas con color creadas", rojo.status === 201 && verde.status === 201 && sinColor.status === 201);
  const tRojo = rojo.json?.tag;
  const tVerde = verde.json?.tag;
  const tNada = sinColor.json?.tag;

  const N = { a: `Ana Color ${RUN}`, b: `Beto Gris ${RUN}` };
  const tel = (i) => `5214630${RUN.slice(-5)}${i}`;
  let i = 0;
  for (const name of Object.values(N)) {
    const r = await call("POST", "/api/dev/wa-mock/inbound", {
      phoneNumberId: PN, from: tel(++i), name, text: `hola ${name}`, waMessageId: `wamid.col.${RUN}.${i}.${Date.now()}`,
    });
    ok(`entrante de ${name}`, r.status < 400, String(r.status));
  }
  ok("las 2 conversaciones están", await hasta(async () => (await convs()).filter((c) => Object.values(N).includes(c.contact.name)).length === 2));
  const A = (await convs()).find((c) => c.contact.name === N.a);
  const B = (await convs()).find((c) => c.contact.name === N.b);
  // Ana: rojo primero (orden alfabético: Pagado, Urgente → fijamos solo rojo + verde y vemos cuál va primero).
  await call("PUT", `/api/contacts/${A.contact.id}/tags`, { tagIds: [tRojo.id] });
  await call("PUT", `/api/contacts/${B.contact.id}/tags`, { tagIds: [tNada.id] });

  const page = await ctx.newPage();
  await page.goto(`${BASE}/inbox`, { timeout: 180000, waitUntil: "domcontentloaded" });
  const row = (name) => page.locator("[data-conversation-row]", { hasText: name });
  ok("la lista carga con Ana", await ver(row(N.a), 120000));
  await page.waitForLoadState("networkidle").catch(() => {});
  const tagCap = (name) => row(name).getByRole("button", { name: /^Etiquetas:/ });
  const stageCap = (name) => row(name).getByRole("button", { name: /^Etapa:/ });
  const asignCap = (name) => row(name).getByRole("button", { name: /^Asignado:/ });

  console.log("== 1. La cápsula toma el color de la etiqueta ==");
  ok("Ana muestra «Urgente»", (await ver(tagCap(N.a))) && (await tagCap(N.a).innerText()).includes(`Urgente${RUN}`));
  const claro = await bg(tagCap(N.a));
  ok("fondo rojizo en claro", esRojizo(claro), claro);
  const gris = await bg(stageCap(N.a));
  ok("…distinto del gris neutro de Etapa", claro !== gris, `${claro} vs ${gris}`);
  const asig = await bg(asignCap(N.a));
  ok("…y Asignado sigue neutro", !esRojizo(asig) && !esVerdoso(asig), asig);
  const grisBeto = await bg(tagCap(N.b));
  ok("una etiqueta SIN color cae al gris de siempre", !esRojizo(grisBeto) && !esVerdoso(grisBeto), grisBeto);
  await shot(page, "colores-claro");

  console.log("== 2. En oscuro ==");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await sleep(500);
  const oscuro = await bg(tagCap(N.a));
  ok("sigue rojizo en oscuro", esRojizo(oscuro), oscuro);
  const colorTexto = await tagCap(N.a).evaluate((el) => getComputedStyle(el).color);
  const [tr, tg, tb] = canales(colorTexto);
  ok("texto legible (claro) sobre el fondo oscuro", (tr + tg + tb) / 3 > 140, colorTexto);
  await shot(page, "colores-oscuro");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.emulateMedia({ colorScheme: "light" });

  console.log("== 3. El menú trae cada etiqueta con su punto ==");
  await tagCap(N.a).click();
  const menu = page.getByRole("menu");
  ok("el menú de etiquetas abre", await ver(menu.getByRole("menuitemcheckbox").first()));
  const item = (name) => menu.getByRole("menuitemcheckbox", { name: new RegExp(name) });
  const punto = (name) => item(name).locator("span.rounded-full").first();
  ok("«Urgente» tiene punto rojizo", esRojizo(await bg(punto(`Urgente${RUN}`))));
  ok("«Pagado» tiene punto verdoso", esVerdoso(await bg(punto(`Pagado${RUN}`))));
  const pg = await bg(punto(`Zeta${RUN}`));
  ok("«Zeta» (sin color) tiene punto gris", !esRojizo(pg) && !esVerdoso(pg), pg);
  await shot(page, "colores-menu");
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);

  console.log("== 4. Recolorear en Ajustes se refleja en la Bandeja ==");
  const patch = await call("PATCH", `/api/contact-tags/${tRojo.id}`, { color: "verde" });
  ok("la etiqueta pasa a verde", patch.status < 400, JSON.stringify(patch.json));
  await page.reload({ waitUntil: "domcontentloaded" });
  ok("la lista recarga", await ver(row(N.a), 120000));
  await page.waitForLoadState("networkidle").catch(() => {});
  ok("la cápsula de Ana ahora es verdosa", await hasta(async () => esVerdoso(await bg(tagCap(N.a))), 15000), await bg(tagCap(N.a)));
  void tVerde;

  console.log("== 5. Etapas ==");
  const dotEtapa = (name) => stageCap(name).locator("span.rounded-full").first();
  const stages = (await call("GET", "/api/pipeline/stages")).json?.stages ?? [];
  const stageNameA = (await convs()).find((c) => c.contact.name === N.a)?.stageName;
  const stageA = stages.find((x) => x.name === stageNameA);
  ok("Ana tiene etapa", Boolean(stageA), JSON.stringify(stageA));
  ok("el API de etapas trae `color` (nulo al inicio)", stageA && "color" in stageA && stageA.color === null, JSON.stringify(stageA));
  const dotInicial = await bg(dotEtapa(N.a));
  ok("sin color elegido, el punto es el de siempre (respaldo)", !esMorado(dotInicial) && !esRojizo(dotInicial), dotInicial);

  const malo = await call("PATCH", `/api/pipeline/stages/${stageA.id}`, { color: "fucsia" });
  ok("un color fuera de la paleta se rechaza", malo.status === 422 || malo.status === 400, String(malo.status));

  // Por la pantalla: Pipeline → Gestionar etapas → círculo «Morado» de la etapa de Ana.
  await page.goto(`${BASE}/pipeline`, { timeout: 180000, waitUntil: "domcontentloaded" });
  const gestionar = page.getByRole("button", { name: /Gestionar etapas/ });
  ok("Pipeline carga", await ver(gestionar, 120000));
  await page.waitForLoadState("networkidle").catch(() => {});
  await gestionar.click();
  const grupo = page.getByRole("radiogroup", { name: `Color de ${stageA.name}` });
  ok("el gestor ofrece el selector de color por etapa", await ver(grupo));
  await grupo.getByRole("radio", { name: "Morado" }).click();
  ok("el color de la etapa se guarda", await hasta(async () => (await call("GET", "/api/pipeline/stages")).json?.stages?.find((x) => x.id === stageA.id)?.color === "morado"));
  await shot(page, "etapas-gestor");

  await page.goto(`${BASE}/inbox`, { timeout: 180000, waitUntil: "domcontentloaded" });
  ok("la Bandeja carga", await ver(row(N.a), 120000));
  await page.waitForLoadState("networkidle").catch(() => {});
  ok("el punto de la cápsula de etapa es morado", await hasta(async () => esMorado(await bg(dotEtapa(N.a))), 15000), await bg(dotEtapa(N.a)));
  ok("la cápsula de etapa sigue neutra (solo el punto se tiñe)", !esMorado(await bg(stageCap(N.a))));
  await stageCap(N.a).click();
  const menuE = page.getByRole("menu");
  ok("el menú de etapas abre", await ver(menuE.getByRole("menuitemradio").first()));
  const opcion = menuE.getByRole("menuitemradio", { name: new RegExp(`^${stageA.name}`) });
  ok("…y la opción de esa etapa lleva el punto morado", esMorado(await bg(opcion.locator("span.rounded-full").first())));
  await shot(page, "etapas-menu-claro");
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await sleep(500);
  ok("en oscuro el punto sigue morado", esMorado(await bg(dotEtapa(N.a))), await bg(dotEtapa(N.a)));
  await shot(page, "etapas-oscuro");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.emulateMedia({ colorScheme: "light" });

  console.log("== 6. Móvil ==");
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(600);
  ok("la fila de Ana se ve en móvil", await ver(row(N.a)));
  ok("la cápsula de etiquetas sigue teñida", esVerdoso(await bg(tagCap(N.a))));
  ok("el punto de etapa sigue morado", esMorado(await bg(dotEtapa(N.a))));
  const desborda = await row(N.a).evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  ok("la fila no desborda en horizontal", !desborda);
  await shot(page, "colores-movil");

  // «Auto» (quitar el color) vuelve al respaldo.
  await page.setViewportSize({ width: 1440, height: 900 });
  const quita = await call("PATCH", `/api/pipeline/stages/${stageA.id}`, { color: null });
  ok("quitar el color (null) se acepta", quita.status < 400, JSON.stringify(quita.json));
  await page.reload({ waitUntil: "domcontentloaded" });
  ok("la lista recarga", await ver(row(N.a), 120000));
  await page.waitForLoadState("networkidle").catch(() => {});
  ok("sin color, el punto vuelve al respaldo", await hasta(async () => !esMorado(await bg(dotEtapa(N.a))), 15000));
} catch (e) {
  failures++;
  console.log("  FAIL excepción:", e);
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nTODO OK" : `\n${failures} FALLO(S)`);
process.exit(failures === 0 ? 0 : 1);
