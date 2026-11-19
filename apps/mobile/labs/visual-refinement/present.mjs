// Assemble actual captured pixels; no generated artwork or network resources.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const lab = path.resolve("labs/visual-refinement");
const out = path.join(lab, "output");
const variants = ["actual", "A", "B", "C"];
const labels = [
  "Actual · Referencia",
  "A · Refinamiento mínimo",
  "B · Moderna y compacta",
  "C · Identidad refinada",
];
const pngs = Object.fromEntries(
  fs
    .readdirSync(out)
    .filter((n) => /^(bandeja|crm|contacts)-.*\.png$/.test(n))
    .map((n) => [
      n,
      "data:image/png;base64," +
        fs.readFileSync(path.join(out, n)).toString("base64"),
    ]),
);
const filename = (screen, v, theme, size) =>
  `${screen}-${v}-${theme}-${size}.png`;
const table = `<table><caption>Medidas propuestas · unidades lógicas React Native</caption><thead><tr><th>Variable</th><th>Actual</th><th>A</th><th>B</th><th>C</th></tr></thead><tbody>
<tr><th>Título: tamaño / línea / peso</th><td>26 / 32 / 600</td><td>25 / 32 / 600</td><td>24 / 30 / 500</td><td>25 / 32 / 600</td></tr>
<tr><th>Icono: tamaño / trazo</th><td>22 / 1.8</td><td>21 / 1.8</td><td>21 / 1.8</td><td>22 / 1.9</td></tr>
<tr><th>Selector: alto total / radio exterior</th><td>56 / 12</td><td>56 / 16</td><td>52 / 26</td><td>54 / 20</td></tr>
<tr><th>Selector: padding / radio interior / letra</th><td>4 / 10 / 14</td><td>4 / 12 / 14</td><td>2 / 24 / 13.5</td><td>3 / 16 / 14</td></tr>
<tr><th>Filtro: alto visual / padding horizontal / gap</th><td>36 / 14 / 8</td><td>35 / 14 / 8</td><td>32 / 12 / 6</td><td>34 / 14 / 8</td></tr>
<tr><th>Nombre / vista previa</th><td>16 / 14</td><td>16 / 14</td><td>15.5 / 13.5</td><td>16 / 14</td></tr>
<tr><th>Color</th><td>Tokens aprobados</td><td>Sin cambio</td><td>Sin cambio</td><td>Turquesa y vista previa con más contraste</td></tr></tbody></table>`;
const style = `*{box-sizing:border-box}body{margin:0;background:#f0f2f5;color:#20252b;font:15px/1.5 system-ui,sans-serif}header,main{padding:20px 24px}header{background:white;border-bottom:1px solid #d4dae0}h1{margin:0;font-size:25px}p{max-width:1000px}label{display:inline-flex;gap:8px;align-items:center;margin:4px 16px 4px 0}select,button{font:inherit;border:1px solid #b5bec8;border-radius:8px;padding:7px;background:white;color:#20252b}button{cursor:pointer}.scroll{overflow:auto;padding:12px 0 24px}.grid{display:flex;gap:20px;width:max-content}.card{margin:0}.card figcaption{height:36px;font-weight:650;white-space:nowrap}.frame{overflow:hidden;background:white;box-shadow:0 0 0 1px #cbd2da}.frame img{display:block;width:100%;height:auto}table{border-collapse:collapse;background:white;font-size:14px}caption{text-align:left;font-weight:650;padding:16px 0}th,td{padding:10px;border:1px solid #d4dae0;text-align:left}small{color:#4e5864}.notice{border-left:4px solid #0b6a6d;padding:8px 14px;background:#fff}.board-title{padding:16px 0 8px;margin:0;font-size:21px}`;

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashfort · Laboratorio visual</title><style>${style}</style></head><body>
<header><h1>Dashfort Mobile · Laboratorio de refinamiento</h1><p>Actual + tres propuestas reproducibles con los componentes reales. Nada aplicado a la aplicación aprobada.</p>
<label>Pantalla <select id="screen" aria-label="Pantalla"><option value="bandeja">Bandeja</option><option value="crm">CRM</option><option value="contacts">Contactos</option></select></label>
<label>Tema <select id="theme" aria-label="Tema"><option value="light">Claro</option><option value="dark">Oscuro</option></select></label>
<label>Resolución <select id="size" aria-label="Resolución"><option>390x844</option><option>360x640</option></select></label>
<label>Vista <select id="focus" aria-label="Vista"><option value="full">Completa</option><option value="header">Detalle del encabezado</option></select></label>
<label>Escala <select id="scale" aria-label="Escala"><option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option></select></label>
<p><small>Abre este HTML directamente, sin servidor ni conexión. En un teléfono, desliza horizontalmente para comparar las cuatro columnas. La resolución corresponde al área de la app, sin barras del sistema operativo.</small></p></header>
<main><div class="scroll"><div id="grid" class="grid"></div></div>
<div class="notice"><strong>Recomendación: A.</strong> Mantiene la jerarquía actual y solo suaviza título, iconos y redondeos. B explora mayor compactación visual. C ajusta el turquesa y aumenta el contraste de las vistas previas. Ninguna opción se aplicará sin aprobación.</div>
${table}<p>En C, el selector activo usa Inter 600 en lugar de 500. Consulta LEEME.md para colores exactos, alcance, riesgos y reproducción.</p>
<p>32 capturas: 16 de Bandeja (4 versiones × 2 temas × 2 tamaños), 8 de CRM y 8 de Contactos (390×844). Las hojas comparativas de la carpeta comparaciones incluyen las cuatro versiones juntas.</p>
<p>Validación: React Native Web + Chromium sin red, FlashList real y datos ficticios. No es una prueba nativa Android/iOS. Fuente: f3f467abb7640ec13ffba590bc5dad91bc5cfd77. No hay APK nueva ni cambios de backend.</p></main>
<script>const images=${JSON.stringify(pngs)},variants=${JSON.stringify(variants)},labels=${JSON.stringify(labels)};const ids=['screen','theme','size','focus','scale'];const el=id=>document.getElementById(id);function update(){const screen=el('screen').value;if(screen!=='bandeja')el('size').value='390x844';el('size').disabled=screen!=='bandeja';const size=el('size').value,[w,h]=size.split('x').map(Number),scale=Number(el('scale').value),height=el('focus').value==='header'?252:h;el('grid').innerHTML=variants.map((v,i)=>'<figure class="card"><figcaption>'+labels[i]+'</figcaption><div class="frame" style="width:'+w*scale+'px;height:'+height*scale+'px"><img alt="'+labels[i]+' '+screen+' '+el('theme').value+' '+size+'" src="'+images[screen+'-'+v+'-'+el('theme').value+'-'+size+'.png']+'"></div></figure>').join('')}ids.forEach(id=>el(id).addEventListener('change',update));update();</script></body></html>`;
fs.writeFileSync(path.join(out, "index.html"), html);

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ offline: true });
await context.route("**/*", (r) => r.abort());
const page = await context.newPage();
try {
  for (const screen of ["bandeja", "crm", "contacts"])
    for (const theme of ["light", "dark"])
      for (const size of screen === "bandeja"
        ? ["390x844", "360x640"]
        : ["390x844"])
        for (const focus of screen === "bandeja"
          ? ["full", "header"]
          : ["full"]) {
          const [w, h] = size.split("x").map(Number),
            height = focus === "header" ? 252 : h;
          await page.setViewportSize({
            width: w * 4 + 108,
            height: height + 152,
          });
          const cards = variants
            .map(
              (v, i) =>
                `<figure class="card"><figcaption>${labels[i]}</figcaption><div class="frame" style="width:${w}px;height:${height}px"><img alt="${labels[i]}" src="${pngs[filename(screen, v, theme, size)]}"></div></figure>`,
            )
            .join("");
          await page.setContent(
            `<!doctype html><meta charset="utf-8"><style>${style}</style><main><h1 class="board-title">Dashfort · ${screen === "bandeja" ? "Bandeja" : screen === "crm" ? "CRM" : "Contactos"} · ${theme === "light" ? "Claro" : "Oscuro"} · ${size}</h1><small>Componentes reales · datos ficticios · propuesta sin aplicar · React Native Web</small><div style="height:12px"></div><div class="grid">${cards}</div></main>`,
          );
          await page.screenshot({
            fullPage: true,
            path: path.join(
              out,
              `comparacion-${screen}-${theme}-${size}-${focus}.png`,
            ),
          });
        }
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setContent(html);
  await page.getByLabel("Tema", { exact: true }).selectOption("dark");
  await page.getByLabel("Resolución").selectOption("360x640");
  await page.getByLabel("Vista", { exact: true }).selectOption("header");
  if ((await page.locator("#grid img").count()) !== 4)
    throw Error("Comparison gallery is incomplete");
  await page.getByLabel("Pantalla", { exact: true }).selectOption("contacts");
  if ((await page.locator("#size").inputValue()) !== "390x844")
    throw Error("Gallery must use captured sizes");
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "12 side-by-side boards; standalone offline HTML checked: theme, size, header detail and Contacts.",
  );
} finally {
  await browser.close();
}
