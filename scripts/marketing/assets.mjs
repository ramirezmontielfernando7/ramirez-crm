/**
 * Genera los recursos ficticios de la demo en marketing/.assets/:
 *  - producto-rotomartillo.png, producto-cemento.png (fotos de producto ilustradas)
 *  - comprobante-spei.png (comprobante de transferencia inventado)
 *  - catalogo-el-martillo.pdf (catálogo de 2 páginas)
 *  - lista-precios-mayoreo.pdf (adjunto del chat de equipo)
 *  - clientes-septiembre.csv (12 contactos para el video de importar)
 * Todo inventado: nombres, montos, claves de rastreo y teléfonos +52 998 555 01XX.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve("marketing/.assets");
mkdirSync(OUT, { recursive: true });

const FONT = `font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;`;

const drill = `
<svg viewBox="0 0 900 900" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#f7f4ee"/><stop offset="1" stop-color="#ddd6c8"/></radialGradient>
    <linearGradient id="body" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffcc33"/><stop offset="1" stop-color="#e0a000"/></linearGradient>
    <linearGradient id="dark" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3a3a3a"/><stop offset="1" stop-color="#151515"/></linearGradient>
    <linearGradient id="metal" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#e8e8e8"/><stop offset=".5" stop-color="#9a9a9a"/><stop offset="1" stop-color="#d0d0d0"/></linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="18" flood-opacity=".28"/></filter>
  </defs>
  <rect width="900" height="900" fill="url(#bg)"/>
  <ellipse cx="450" cy="760" rx="300" ry="34" fill="#000" opacity=".12"/>
  <g filter="url(#sh)">
    <rect x="120" y="270" width="140" height="44" rx="10" fill="url(#metal)"/>
    <rect x="40" y="282" width="100" height="20" rx="6" fill="#8d8d8d"/>
    <path d="M40 286 l-22 6 l22 6 z" fill="#777"/>
    <rect x="240" y="235" width="120" height="115" rx="20" fill="url(#dark)"/>
    <path d="M340 205 h330 a70 70 0 0 1 70 70 v40 a70 70 0 0 1 -70 70 h-330 z" fill="url(#body)"/>
    <rect x="360" y="230" width="250" height="30" rx="15" fill="#222" opacity=".85"/>
    <text x="485" y="252" font-size="22" fill="#ffcc33" text-anchor="middle" font-family="Arial Black, Arial" font-weight="900">20V MAX</text>
    <path d="M520 385 h120 l-40 250 h-120 z" fill="url(#dark)"/>
    <path d="M540 400 h80 l-30 200 h-80 z" fill="url(#body)" opacity=".9"/>
    <rect x="455" y="400" width="44" height="70" rx="12" fill="#c62828"/>
    <rect x="420" y="630" width="250" height="110" rx="18" fill="url(#dark)"/>
    <rect x="440" y="650" width="210" height="16" rx="8" fill="#ffcc33"/>
  </g>
  <text x="450" y="840" font-size="30" fill="#5b544a" text-anchor="middle" font-family="Arial">Rotomartillo inalámbrico 20V · con 2 baterías</text>
</svg>`;

const cement = `
<svg viewBox="0 0 900 900" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg2" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#cfd8dc"/><stop offset="1" stop-color="#90a4ae"/></linearGradient>
    <linearGradient id="bag" x1="0" x2="1"><stop offset="0" stop-color="#b0b0ac"/><stop offset=".45" stop-color="#e9e7e1"/><stop offset="1" stop-color="#a7a6a0"/></linearGradient>
    <filter id="sh2"><feDropShadow dx="0" dy="14" stdDeviation="14" flood-opacity=".3"/></filter>
  </defs>
  <rect width="900" height="900" fill="url(#bg2)"/>
  <rect y="690" width="900" height="210" fill="#6d4c41"/>
  <rect y="690" width="900" height="14" fill="#5d4037"/>
  <g filter="url(#sh2)">
    <path d="M150 380 q-10 -40 30 -50 h540 q40 10 30 50 l-20 300 q-4 30 -40 30 h-480 q-36 0 -40 -30 z" fill="url(#bag)"/>
    <path d="M170 170 q-10 -40 30 -50 h500 q40 10 30 50 l-18 200 q-4 30 -40 30 h-444 q-36 0 -40 -30 z" fill="url(#bag)"/>
    <rect x="240" y="200" width="420" height="120" rx="12" fill="#c62828"/>
    <text x="450" y="262" font-size="54" fill="#fff" text-anchor="middle" font-family="Arial Black, Arial" font-weight="900">CEMENTO</text>
    <text x="450" y="302" font-size="28" fill="#fff" text-anchor="middle" font-family="Arial">Gris · Portland CPC 30R</text>
    <rect x="230" y="440" width="440" height="140" rx="12" fill="#1565c0"/>
    <text x="450" y="515" font-size="70" fill="#fff" text-anchor="middle" font-family="Arial Black, Arial" font-weight="900">50 kg</text>
    <text x="450" y="560" font-size="26" fill="#bbdefb" text-anchor="middle" font-family="Arial">Uso general · Alta resistencia</text>
  </g>
  <text x="450" y="820" font-size="30" fill="#fff3e0" text-anchor="middle" font-family="Arial">Existencia en bodega · Av. Hidalgo 245</text>
</svg>`;

const comprobante = `
<div style="${FONT} width:720px; background:#fff; padding:40px 44px; box-sizing:border-box; color:#1f2937">
  <div style="display:flex; align-items:center; justify-content:space-between">
    <div style="font-weight:800; font-size:26px; color:#0f4c81">Banco Ficticio del Sureste</div>
    <div style="font-size:14px; color:#6b7280">Comprobante electrónico</div>
  </div>
  <div style="margin-top:28px; font-size:15px; color:#059669; font-weight:700">✔ Transferencia SPEI enviada</div>
  <div style="font-size:44px; font-weight:800; margin:8px 0 22px">$ 12,480.00 MXN</div>
  <table style="width:100%; font-size:16px; border-collapse:collapse">
    ${[
      ["Beneficiario", "Ferretería El Martillo"],
      ["Cuenta destino", "CLABE •••• •••• 4821"],
      ["Ordenante", "Constructora Ramos Tulum"],
      ["Concepto", "Pedido 1045 · varilla y cemento"],
      ["Clave de rastreo", "DEMO2026092600A1B2"],
      ["Referencia", "1045"],
      ["Fecha y hora", "26/09/2026 · 10:42"],
    ]
      .map(
        ([k, v]) =>
          `<tr><td style="padding:10px 0; color:#6b7280; border-bottom:1px solid #eee">${k}</td><td style="padding:10px 0; text-align:right; font-weight:600; border-bottom:1px solid #eee">${v}</td></tr>`
      )
      .join("")}
  </table>
  <div style="margin-top:22px; font-size:12px; color:#9ca3af">Documento de demostración. Datos ficticios.</div>
</div>`;

const catalogoRows = [
  ["Cemento gris CPC 30R 50 kg", "$245", "$232 (10+)"],
  ["Mortero 50 kg", "$198", "$186 (10+)"],
  ["Varilla corrugada 3/8\" 12 m", "$168", "$158 (50+)"],
  ["Pintura vinílica 19 L", "$1,150", "$1,060 (5+)"],
  ["Impermeabilizante acrílico 5 años 19 L", "$1,680", "$1,590 (5+)"],
  ["Taladro inalámbrico 20V", "$1,899", "—"],
  ["Rotomartillo 20V MAX", "$3,450", "—"],
  ["Cable THW cal. 12 (100 m)", "$1,890", "$1,780 (5+)"],
  ["Alambre recocido (kg)", "$42", "$38 (25+)"],
  ["Block de concreto 15x20x40", "$16", "$14 (500+)"],
];
const catalogo = `
<html><body style="${FONT} margin:0; color:#1f2937">
  <div style="padding:48px">
    <div style="font-size:14px; letter-spacing:.2em; color:#12999d; font-weight:700">FERRETERÍA EL MARTILLO</div>
    <h1 style="font-size:40px; margin:8px 0 4px">Catálogo principal · Septiembre</h1>
    <p style="color:#6b7280; margin:0 0 28px">Precios en MXN con IVA. Mayoreo según cantidad indicada.</p>
    <table style="width:100%; border-collapse:collapse; font-size:16px">
      <tr style="background:#12999d; color:#fff"><th style="text-align:left; padding:12px">Producto</th><th style="padding:12px">Menudeo</th><th style="padding:12px">Mayoreo</th></tr>
      ${catalogoRows
        .map(
          (r, i) =>
            `<tr style="background:${i % 2 ? "#f5f7f7" : "#fff"}"><td style="padding:12px">${r[0]}</td><td style="padding:12px; text-align:center">${r[1]}</td><td style="padding:12px; text-align:center">${r[2]}</td></tr>`
        )
        .join("")}
    </table>
    <p style="margin-top:28px; color:#6b7280">Av. Hidalgo 245, colonia Centro · Lunes a sábado 8:00–19:00 · Domingo 9:00–14:00</p>
  </div>
</body></html>`;

const listaMayoreo = catalogo
  .replace("Catálogo principal · Septiembre", "Lista de precios de mayoreo · Octubre (borrador)")
  .replace("Precios en MXN con IVA.", "Solo uso interno del equipo de ventas.");

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function shotSvg(svg, file) {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await page.locator("svg").screenshot({ path: path.join(OUT, file) });
}
await shotSvg(drill, "producto-rotomartillo.png");
await shotSvg(cement, "producto-cemento.png");

await page.setViewportSize({ width: 720, height: 900 });
await page.setContent(`<html><body style="margin:0; background:#fff">${comprobante}</body></html>`);
await page.locator("body > div").screenshot({ path: path.join(OUT, "comprobante-spei.png") });

await page.setContent(catalogo);
await page.pdf({ path: path.join(OUT, "catalogo-el-martillo.pdf"), format: "Letter" });
await page.setContent(listaMayoreo);
await page.pdf({ path: path.join(OUT, "lista-precios-mayoreo.pdf"), format: "Letter" });
await browser.close();

// CSV de 12 contactos ficticios para el video 09 (teléfonos +52 998 555 0181…0192).
const csvPeople = [
  "Rosa Elena Cituk", "Jesús Alberto Pech", "Mariana Canul", "Óscar Balam",
  "Fernanda Chi", "Raúl Uc", "Gabriela May", "Tomás Ek",
  "Daniela Poot", "Arturo Koh", "Silvia Tun", "Enrique Dzul",
];
const csv = [
  "nombre,telefono,fuente,consentimiento",
  ...csvPeople.map((n, i) => {
    const tel = `+52 998 555 01${String(81 + i).padStart(2, "0")}`;
    const nota = ["referido", "organico", "anuncio", "conocido"][i % 4];
    return `${n},${tel},${nota},${i % 3 === 2 ? "desconocido" : "opt_in"}`;
  }),
].join("\n");
writeFileSync(path.join(OUT, "clientes-septiembre.csv"), csv + "\n");
console.log("[assets] listos en", OUT);
