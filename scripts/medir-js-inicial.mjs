/**
 * Tamaño del JavaScript INICIAL de una ruta (por defecto /inbox), leído del
 * build (`pnpm build` antes): suma, comprimido con gzip, los archivos que el
 * navegador baja al abrir la página (los de arranque de Next más los de los
 * componentes de cliente que la ruta usa de entrada). Lo que se carga «bajo
 * demanda» (`next/dynamic`) no entra: ese es el punto de medirlo.
 *
 *   node scripts/medir-js-inicial.mjs            # /inbox
 *   node scripts/medir-js-inicial.mjs inbox      # ruta dentro de src/app/(app)
 *   node scripts/medir-js-inicial.mjs inbox --detalle
 */
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const ruta = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) ?? "inbox";
const detalle = process.argv.includes("--detalle");
const next = join(process.cwd(), ".next");

const build = JSON.parse(readFileSync(join(next, "build-manifest.json"), "utf8"));
const ref = readFileSync(
  join(next, "server/app/(app)", ruta, "page_client-reference-manifest.js"),
  "utf8"
);

const archivos = new Set([...build.rootMainFiles, ...build.polyfillFiles]);
for (const m of ref.matchAll(/static\/chunks\/[^"'\\]+?\.js/g)) archivos.add(m[0]);

let total = 0;
const filas = [];
for (const f of archivos) {
  const gz = gzipSync(readFileSync(join(next, f))).length;
  total += gz;
  filas.push([gz, f]);
}
if (detalle) {
  for (const [gz, f] of filas.sort((a, b) => b[0] - a[0]))
    console.log(`${(gz / 1024).toFixed(1).padStart(7)} KB  ${f}`);
}
console.log(`JS inicial de /${ruta}: ${(total / 1024).toFixed(1)} KB gzip (${archivos.size} archivos)`);
