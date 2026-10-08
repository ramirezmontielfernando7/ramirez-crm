/**
 * 035 — Mide la RAM REAL del contenedor de embeddings (TEI en CPU con
 * multilingual-e5-small) mientras indexa un documento grande, para fijar su
 * `mem_limit` con un número medido y no estimado.
 *
 *   node scripts/kb-medir-ram.mjs                # arranca su propio contenedor (sin límite) y lo borra al final
 *   node scripts/kb-medir-ram.mjs --contenedor vocero-embeddings --url http://127.0.0.1:8080
 *                                                # mide uno que ya está corriendo
 *
 * Qué hace: espera a que el servicio responda; mide la RAM en reposo; manda
 * un documento del tamaño MÁXIMO permitido (300 000 caracteres ≈ 440
 * fragmentos) como lo hace Vocero (lotes de 32 con «passage: »), DOS a la vez
 * (el tope de indexado simultáneo de la app), mientras lee `docker stats`
 * cada medio segundo; y luego 50 preguntas («query: ») como en los turnos.
 * Imprime reposo, pico y una recomendación de `mem_limit` (pico + 30 %).
 *
 * Necesita Docker y salida a ghcr.io y huggingface.co (la imagen y el modelo).
 */
import { execFileSync } from "node:child_process";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), [])
);
const IMAGE = "ghcr.io/huggingface/text-embeddings-inference:cpu-1.8";
const MODEL = args.modelo ?? "intfloat/multilingual-e5-small";
const NAME = args.contenedor ?? `vocero-emb-medicion-${process.pid}`;
const PROPIO = !args.contenedor;
const URL_BASE = args.url ?? "http://127.0.0.1:18080";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const docker = (...a) => execFileSync("docker", a, { encoding: "utf8" }).trim();

function memMiB() {
  const raw = docker("stats", "--no-stream", "--format", "{{.MemUsage}}", NAME).split("/")[0].trim();
  const n = Number.parseFloat(raw);
  if (/GiB/i.test(raw)) return n * 1024;
  if (/MiB/i.test(raw)) return n;
  if (/KiB/i.test(raw)) return n / 1024;
  return n / (1024 * 1024);
}

async function embed(input) {
  const res = await fetch(`${URL_BASE}/v1/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, input }),
  });
  if (!res.ok) throw new Error(`el servicio respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** ~300 000 caracteres de español variado (como un manual + lista de precios). */
function documentoGrande(semilla) {
  const frases = [
    "El envío es gratis en compras mayores a 1,500 pesos y llega en 3 a 5 días hábiles.",
    "Las herramientas eléctricas tienen garantía de seis meses presentando el ticket de compra.",
    "Aceptamos pagos con tarjeta de crédito, débito, transferencia y efectivo en tienda.",
    "Para devoluciones, el producto debe estar sin uso y en su empaque original dentro de 15 días.",
    "Nuestro horario de atención es de lunes a sábado de 9:00 a 19:00 horas.",
    "El taladro inalámbrico de 20 V incluye dos baterías, cargador y maletín.",
    "La pintura vinílica para interiores rinde aproximadamente 12 metros cuadrados por litro.",
    "Si tu pedido llega dañado, envíanos una foto por WhatsApp y lo reponemos sin costo.",
  ];
  let out = "";
  for (let i = 0; out.length < 300_000; i++) out += `${frases[(i + semilla) % frases.length]} (ref. ${semilla}-${i})\n\n`;
  return out.slice(0, 300_000);
}

function fragmentos(texto) {
  const out = [];
  for (let i = 0; i < texto.length; i += 680) out.push(texto.slice(i, i + 800));
  return out;
}

async function indexar(texto) {
  const fr = fragmentos(texto);
  for (let i = 0; i < fr.length; i += 32) await embed(fr.slice(i, i + 32).map((t) => `passage: ${t}`));
  return fr.length;
}

async function main() {
  if (PROPIO) {
    console.log(`Arrancando ${IMAGE} con ${MODEL} (sin límite de memoria, para ver el pico real)…`);
    // Bloquea hasta descargar la imagen y arrancar: si no se puede, falla aquí.
    docker("run", "-d", "--rm", "--name", NAME, "-p", "18080:80", "-e", `MODEL_ID=${MODEL}`, "-e", "AUTO_TRUNCATE=true", IMAGE);
  }
  const fin = Date.now() + 15 * 60_000;
  for (;;) {
    try {
      const r = await fetch(`${URL_BASE}/health`);
      if (r.ok) break;
    } catch {
      // todavía no
    }
    if (Date.now() > fin) throw new Error("el servicio no respondió en 15 minutos (¿se pudo descargar la imagen y el modelo?)");
    await sleep(2000);
  }
  await embed(["query: hola"]);
  await sleep(3000);
  const reposo = memMiB();
  console.log(`RAM en reposo (modelo cargado): ${reposo.toFixed(0)} MiB`);

  let pico = reposo;
  let midiendo = true;
  const muestreo = (async () => {
    while (midiendo) {
      try {
        pico = Math.max(pico, memMiB());
      } catch {
        // el contenedor pudo reiniciarse
      }
      await sleep(500);
    }
  })();

  const t0 = Date.now();
  const [n1, n2] = await Promise.all([indexar(documentoGrande(1)), indexar(documentoGrande(5))]);
  const tIndex = (Date.now() - t0) / 1000;
  const t1 = Date.now();
  for (let i = 0; i < 50; i++) await embed([`query: ¿cuánto cuesta el envío a Monterrey? ${i}`]);
  const msPregunta = (Date.now() - t1) / 50;
  midiendo = false;
  await muestreo;
  const final = memMiB();

  console.log(`Indexado: 2 documentos de 300 000 caracteres a la vez (${n1 + n2} fragmentos) en ${tIndex.toFixed(1)} s`);
  console.log(`Pregunta: ${msPregunta.toFixed(0)} ms en promedio (50 preguntas)`);
  console.log(`RAM pico: ${pico.toFixed(0)} MiB · al terminar: ${final.toFixed(0)} MiB`);
  const sugerido = Math.ceil((pico * 1.3) / 128) * 128;
  console.log(`mem_limit sugerido (pico + 30 %, redondeado): ${sugerido} MiB`);
}

main()
  .catch((err) => {
    console.error(`Error: ${err?.message ?? err}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (PROPIO) {
      try {
        docker("rm", "-f", NAME);
      } catch {
        // ya no existe
      }
    }
  });
