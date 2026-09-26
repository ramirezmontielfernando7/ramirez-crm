/**
 * Sidecar de mocks para la instancia de MARKETING (build de producción).
 *
 * Los mocks integrados (`/api/dev/*`) responden 404 en `next start` por diseño
 * (`dev-guard`: NODE_ENV=production). Este proceso aparte sirve el MISMO código
 * de mocks de la app —importado tal cual, sin modificarlo— en otro puerto:
 *   META_GRAPH_BASE_URL = http://127.0.0.1:4010/api/dev/wa-mock/graph
 *   OPENROUTER_BASE_URL = http://127.0.0.1:4010/api/dev/ai-mock
 *
 * Además expone:
 *   POST /inbound          → entrante simulado firmado (HMAC con el META_APP_SECRET ficticio)
 *   POST /template-status  → aprueba/rechaza una plantilla en el "panel de Meta" simulado
 *   GET  /outbox           → lo que la app "envió" a WhatsApp
 *
 * La IA simulada contesta como el agente de la ferretería (respuestas de
 * guion, deterministas); el juez del Laboratorio y el asistente de redacción
 * siguen usando el mock original.
 *
 * Uso: node --env-file=.env.marketing scripts/marketing/.build/mock-server.mjs
 */
import http from "node:http";
import { createHmac } from "node:crypto";
import * as graph from "@/app/api/dev/wa-mock/graph/[...path]/route";
import * as mediaFile from "@/app/api/dev/wa-mock/media-file/[id]/route";
import { aiMockCompletion } from "@/server/dev/ai-mock";
import { getWaMockState } from "@/server/dev/wa-mock-state";
import {
  buildInboundPayload,
  buildTemplateStatusPayload,
} from "@/server/dev/wa-mock-inbound";
import { JUDGE_MARKER } from "@/server/ai/prompts";
import { WRITING_ASSIST_MARKER } from "@/server/writing-assist/prompts";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const APP = process.env.APP_INTERNAL_URL ?? "http://127.0.0.1:3000";

async function deliver(payload: unknown): Promise<Response> {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const secret = process.env.META_APP_SECRET;
  if (secret) {
    headers["x-hub-signature-256"] =
      "sha256=" + createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  }
  return fetch(`${APP}/api/webhooks/wa/${process.env.META_WEBHOOK_VERIFY_TOKEN}`, {
    method: "POST",
    headers,
    body: raw,
  });
}

/* ---------------- IA simulada del agente "Martillito" ---------------- */

type Msg = { role: string; content: string };

function norm(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function marketingAgent(messages: Msg[]): string {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  if (system.includes(JUDGE_MARKER) || system.includes(WRITING_ASSIST_MARKER)) {
    return aiMockCompletion(messages);
  }
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const t = norm(lastUser);
  const reply = (text: string) => JSON.stringify({ action: "reply", text });

  if (/humano|asesor|persona|factura|queja|danad|devol/.test(t)) {
    return JSON.stringify({
      action: "handoff",
      reason: "cliente",
      farewell:
        "Con gusto. Te paso con un asesor de nuestro equipo que te ayuda con eso en un momento. 🙌",
    });
  }
  if (/horario|abren|cierran|domingo|a que hora/.test(t)) {
    return reply(
      "Nuestro horario es de lunes a sábado de 8:00 a 19:00 y domingos de 9:00 a 14:00. Estamos en Av. Hidalgo 245, colonia Centro. ¿Te aparto algo para que pases por él?"
    );
  }
  if (/cemento/.test(t)) {
    return reply(
      "El bulto de cemento gris de 50 kg está en $245 MXN. A partir de 10 bultos te queda en $232 MXN cada uno, y la entrega local es el mismo día si confirmas antes de la 1 pm. ¿Cuántos necesitas?"
    );
  }
  if (/varilla/.test(t)) {
    return reply(
      "La varilla corrugada de 3/8\" está en $168 MXN la pieza de 12 m; por tonelada te cotizo precio especial de mayoreo. ¿Qué cantidad necesitas?"
    );
  }
  if (/pintura|vinilica|cubeta|impermeab/.test(t)) {
    return reply(
      "La cubeta de pintura vinílica de 19 L está en $1,150 MXN y rinde unos 90 m². Manejamos Comex y Berel en mate y satinado. ¿De qué color la buscas?"
    );
  }
  if (/taladro|rotomartillo|esmeril|herramienta|sierra/.test(t)) {
    return reply(
      "Tenemos el taladro Truper 20V en $1,899 MXN y el DeWalt 20V MAX en $3,450 MXN, los dos con batería y cargador. ¿Para qué trabajo lo necesitas?"
    );
  }
  if (/precio|cuanto|cuesta|cotiza/.test(t)) {
    return reply(
      "¡Con gusto te cotizo! Dime el producto y la cantidad y te paso el precio al momento, con descuento de mayoreo si aplica."
    );
  }
  if (/entrega|envio|flete|domicilio/.test(t)) {
    return reply(
      "Sí hacemos entregas: el mismo día en la zona si confirmas antes de la 1 pm. El flete local es de $150 MXN y es gratis en compras mayores a $3,000 MXN."
    );
  }
  if (/gracias|perfecto|excelente|listo/.test(t)) {
    return reply("¡A ti! Aquí estamos para lo que necesites. 🔨");
  }
  if (/hola|buenas|buen dia|buenos/.test(t)) {
    return reply(
      "¡Hola! Soy Martillito, el asistente de Ferretería El Martillo 🔨 ¿Qué material o herramienta estás buscando hoy?"
    );
  }
  return reply(
    "¡Claro! Cuéntame un poco más de tu proyecto y te recomiendo el material con precio y disponibilidad."
  );
}

/* ---------------- servidor ---------------- */

async function toWebRequest(req: http.IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  return new Request(`http://127.0.0.1:${PORT}${req.url}`, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
}

async function send(res: http.ServerResponse, r: Response) {
  res.statusCode = r.status;
  r.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await r.arrayBuffer()));
}

const json = (v: unknown, status = 200) => Response.json(v, { status });

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;

  const g = p.match(/^\/api\/dev\/wa-mock\/graph\/(.+)$/);
  if (g) {
    const ctx = { params: Promise.resolve({ path: g[1]!.split("/") }) };
    const h = (graph as unknown as Record<string, (r: Request, c: unknown) => Promise<Response>>)[
      req.method
    ];
    return h ? h(req, ctx) : json({ error: "method" }, 405);
  }
  const mf = p.match(/^\/api\/dev\/wa-mock\/media-file\/(.+)$/);
  if (mf) {
    return mediaFile.GET(req, { params: Promise.resolve({ id: mf[1]! }) });
  }
  if (/^\/api\/dev\/ai-mock(\/v1)?\/chat\/completions$/.test(p)) {
    const body = (await req.json().catch(() => ({}))) as { messages?: Msg[] };
    const content = marketingAgent(body.messages ?? []);
    return json({ id: "aimock", choices: [{ index: 0, message: { role: "assistant", content } }] });
  }
  if (p === "/inbound" && req.method === "POST") {
    const b = (await req.json()) as Record<string, unknown>;
    const payload = buildInboundPayload({ wabaId: "WABA-MARTILLO", ...(b as never) });
    const r = await deliver(payload);
    return json({ delivered: r.ok, status: r.status }, r.ok ? 200 : 502);
  }
  if (p === "/template-status" && req.method === "POST") {
    const b = (await req.json()) as {
      wabaId: string;
      name: string;
      language: string;
      event: "APPROVED" | "REJECTED";
      reason?: string;
    };
    const tpl = getWaMockState().templates.find(
      (t) => t.name === b.name && t.language === b.language
    );
    if (tpl) tpl.status = b.event;
    const r = await deliver(buildTemplateStatusPayload({ ...b, templateId: tpl?.id }));
    return json({ delivered: r.ok, status: r.status }, r.ok ? 200 : 502);
  }
  if (p === "/outbox") {
    if (req.method === "DELETE") {
      getWaMockState().outbox.length = 0;
      return json({ ok: true });
    }
    return json({ messages: getWaMockState().outbox });
  }
  if (p === "/health") return json({ ok: true });
  return json({ error: "not_found", path: p }, 404);
}

http
  .createServer(async (req, res) => {
    try {
      await send(res, await route(await toWebRequest(req)));
    } catch (err) {
      console.error("[mock]", req.method, req.url, err);
      res.statusCode = 500;
      res.end(String(err));
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`[mock] escuchando en :${PORT}`));
