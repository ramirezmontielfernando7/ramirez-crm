import { z } from "zod";
import type { ToolOutcome, ToolSpec } from "@/server/ai-connector/tools";
import { agendaEnabled } from "@/server/agenda/flag";
import { botBlock } from "@/server/analytics/bot";
import { hygieneBlock } from "@/server/analytics/hygiene";
import { businessTimezone, PeriodError, resolvePeriod } from "@/server/analytics/period";
import { salesBlock } from "@/server/analytics/sales";
import { resultsScope } from "@/server/analytics/scope";
import { getBranding } from "@/server/branding";
import { listKnowledge } from "@/server/knowledge/store";
import { orgHasModule } from "@/server/modules";
import { createTemplate, TemplateError } from "@/server/whatsapp/templates";

/**
 * 047 — Tercera parte: el material del equipo (Conocimientos que aparecen en
 * la Bandeja), los números de Resultados y crear plantillas.
 *
 * - `list_materials`: lo mismo que el selector del compositor; la IA manda su
 *   texto con `send_message` (con el tope y la marca de siempre). Los
 *   archivos se envían desde la Bandeja.
 * - `get_results`: los bloques de Inteligencia → Resultados con la MISMA
 *   regla de quién ve qué (`resultsScope`: el asesor, lo suyo).
 * - `create_template`: la manda a aprobación de Meta como la pantalla
 *   (`createTemplate`), solo encabezado de texto. Función avanzada
 *   (`area: "campaigns"`) y `templates.manage`.
 */

function fail(error: string, summary: string): ToolOutcome {
  return { data: { error }, summary, isError: true };
}

/* ============================== Material ============================== */

const listMaterialsArgs = z.object({
  query: z.string().trim().max(120).default(""),
  tag: z.string().trim().max(60).optional(),
});

const listMaterials: ToolSpec<z.infer<typeof listMaterialsArgs>> = {
  name: "list_materials",
  title: "Ver el material para enviar",
  description:
    "El material que el equipo envía en los chats (Conocimientos de la Bandeja): título, texto, etiquetas y si trae archivo. " +
    "Para mandarlo tal cual (con su imagen/PDF), usa send_material con su id; para adaptar el texto, send_message.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string", maxLength: 120 }, tag: { type: "string" } },
    additionalProperties: false,
  },
  parse: listMaterialsArgs,
  scope: "read",
  available: (org) => orgHasModule(org, "knowledge"),
  run: async ({ session }, args) => {
    const rows = await listKnowledge(session.organizationId, { q: args.query, tag: args.tag, chatOnly: true });
    return {
      data: {
        materials: rows.map((r) => ({
          id: r.id,
          title: r.title,
          text: r.body.length > 4000 ? `${r.body.slice(0, 4000)}…` : r.body,
          tags: r.tags,
          file: r.filePath && r.fileMime ? { name: r.fileName ?? "archivo", mime: r.fileMime } : null,
        })),
      },
      summary: `${rows.length} materiales`,
    };
  },
};

/* ============================== Resultados ============================== */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const resultsArgs = z.object({
  from: z.string().regex(ISO_DAY).optional(),
  to: z.string().regex(ISO_DAY).optional(),
  sections: z.array(z.enum(["sales", "agent", "hygiene"])).min(1).default(["sales", "agent", "hygiene"]),
});

const getResults: ToolSpec<z.infer<typeof resultsArgs>> = {
  name: "get_results",
  title: "Ver los resultados",
  description:
    "Los números de Resultados en la zona del negocio: sales (ventas, embudo, motivos de pérdida), agent (lo que hizo el agente de IA) " +
    "y hygiene (chats en silencio, mensajes fallidos, ventanas por cerrar). Periodo from/to en AAAA-MM-DD; sin fechas, los últimos 30 días. " +
    "Un asesor ve solo lo suyo.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      sections: { type: "array", items: { type: "string", enum: ["sales", "agent", "hygiene"] } },
    },
    additionalProperties: false,
  },
  parse: resultsArgs,
  scope: "read",
  permission: "results.read",
  available: (org) => orgHasModule(org, "results"),
  run: async ({ session }, args) => {
    const who = resultsScope(session, new URL("http://localhost/"));
    if (!who.ok) return fail("No puedes ver estos resultados", "sin acceso");
    const org = session.organizationId;
    let period;
    try {
      period = resolvePeriod({ from: args.from, to: args.to, timezone: await businessTimezone(org) });
    } catch (err) {
      if (err instanceof PeriodError) return fail(err.message, "periodo no válido");
      throw err;
    }
    const { currency } = await getBranding(org);
    const want = new Set(args.sections);
    const [sales, agent, hygiene] = await Promise.all([
      want.has("sales") ? salesBlock(who.scope, period, currency) : null,
      want.has("agent") ? agendaEnabled(org).then((agenda) => botBlock(who.scope, period, agenda)) : null,
      want.has("hygiene") ? hygieneBlock(who.scope, currency) : null,
    ]);
    return {
      data: {
        period: period.dto,
        currency,
        whose: who.scope.seesAll ? "todo el equipo" : "solo lo tuyo",
        ...(sales ? { sales } : {}),
        ...(agent ? { agent } : {}),
        ...(hygiene ? { hygiene } : {}),
      },
      summary: `resultados ${period.dto.from} a ${period.dto.to}`,
    };
  },
};

/* ============================== Plantillas ============================== */

const buttonArgs = z.discriminatedUnion("type", [
  z.object({ type: z.literal("QUICK_REPLY"), text: z.string().trim().min(1).max(25) }),
  z.object({ type: z.literal("URL"), text: z.string().trim().min(1).max(25), url: z.string().trim().url().max(2000) }),
]);

const templateArgs = z.object({
  name: z.string().trim().min(1).max(60),
  language: z.string().trim().min(2).max(10).default("es_MX"),
  category: z.enum(["UTILITY", "MARKETING"]),
  body: z.string().trim().min(1).max(1024),
  body_examples: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  header_text: z.string().trim().min(1).max(60).optional(),
  footer: z.string().trim().min(1).max(60).optional(),
  buttons: z.array(buttonArgs).max(10).default([]),
});

const createTemplateTool: ToolSpec<z.infer<typeof templateArgs>> = {
  name: "create_template",
  title: "Crear una plantilla de WhatsApp",
  description:
    "Crea una plantilla y la manda a aprobación de Meta (tarda de minutos a horas; mira su estado con list_templates). " +
    "Variables en el cuerpo como {{1}}, {{2}}… con un ejemplo por variable en body_examples. Encabezado solo de texto; " +
    "las de imagen se crean en la pantalla. category: UTILITY (avisos) o MARKETING (promociones).",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "minúsculas y guiones bajos, p. ej. aviso_inscripcion" },
      language: { type: "string", default: "es_MX" },
      category: { type: "string", enum: ["UTILITY", "MARKETING"] },
      body: { type: "string", maxLength: 1024 },
      body_examples: { type: "array", items: { type: "string" } },
      header_text: { type: "string", maxLength: 60 },
      footer: { type: "string", maxLength: 60 },
      buttons: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["QUICK_REPLY", "URL"] },
            text: { type: "string", maxLength: 25 },
            url: { type: "string" },
          },
          required: ["type", "text"],
        },
      },
    },
    required: ["name", "category", "body"],
    additionalProperties: false,
  },
  parse: templateArgs,
  scope: "write",
  permission: "templates.manage",
  area: "campaigns",
  serial: true,
  run: async ({ session }, args) => {
    try {
      const t = await createTemplate(session.organizationId, {
        name: args.name,
        language: args.language,
        category: args.category,
        body: args.body,
        bodyExamples: args.body_examples,
        header: args.header_text ? { format: "TEXT", text: args.header_text } : { format: "NONE" },
        footer: args.footer ?? null,
        buttons: args.buttons,
      });
      return {
        data: { ok: true, id: t.id, name: t.name, status: t.status },
        summary: `mandó a aprobación la plantilla «${t.name}»`,
      };
    } catch (err) {
      if (err instanceof TemplateError) return fail(err.message, `plantilla no creada (${err.code})`);
      throw err;
    }
  },
};

export const EXTRA_TOOLS = [listMaterials, getResults, createTemplateTool];
