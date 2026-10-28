import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { CONSENT_ANSWERS } from "@/lib/import-consent";
import { getDb, schema } from "@/lib/db";
import { scoped, scopedContacts } from "@/lib/db/tenant";
import { normalizeShortcut, BODY_MAX } from "@/lib/quick-replies";
import { TAG_COLORS } from "@/lib/tags";
import { toCsv } from "@/lib/csv";
import { zonedWallClockToUtc } from "@/lib/time/slots";
import type { ToolOutcome, ToolSpec } from "@/server/ai-connector/tools";
import { AgentError, getAgent, listAgents, saveDraft } from "@/server/agents/store";
import { businessTimezone } from "@/server/analytics/period";
import { CampaignError, createCampaign, launchCampaign, listCampaigns, previewCampaign } from "@/server/campaigns/service";
import { SOURCE_FILTER_VALUES } from "@/server/contact-filter";
import { exportContactsCsv } from "@/server/contacts-io/export";
import { importContacts } from "@/server/contacts-io/import";
import { ImportError } from "@/server/contacts-io/validate";
import { createLossReason, LABEL_MAX, listLossReasons, updateLossReason } from "@/server/leads/loss-reasons";
import { orgHasModule } from "@/server/modules";
import { createQuickReply, listQuickReplies, updateQuickReply } from "@/server/quick-replies/store";
import { createTag, listTags, TagError, tagContactsInBulk, updateTag } from "@/server/tags/tags";
import { templateSendability } from "@/server/whatsapp/templates";

/**
 * 047 PR 6 — «Funciones avanzadas» del conector de IA. Cada herramienta lleva
 * su `area` (Ajustes → Conector de IA: el Propietario la enciende; el
 * Coordinador solo si se la dio; el Asesor nunca) y además el MISMO permiso
 * del CRM que su pantalla. Usan las puertas de siempre (servicios de
 * campañas, etiquetas, agentes, respuestas rápidas, motivos de pérdida).
 *
 * - Campañas: `prepare_campaign` la deja como BORRADOR y una persona la
 *   lanza con un clic; `launch_campaign` solo existe con «Puede lanzar
 *   campañas» (`launch: true`).
 * - Agentes: solo el borrador; publicar es de una persona.
 * - Exportar: el CSV vuelve a la IA (tope `AI_EXPORT_MAX`) y queda en la
 *   bitácora como `export_contacts` («Qué hizo la IA del equipo» lo resalta).
 * - Nunca: borrar, conexión de WhatsApp, roles, equipo ni llaves.
 */

/** Más que esto no cabe en la conversación de una IA: que filtre. */
export const AI_EXPORT_MAX = 2000;
const AI_IMPORT_MAX = 500;

function fail(error: string, summary: string): ToolOutcome {
  return { data: { ok: false, error }, summary, isError: true };
}

/** Los nombres de etiqueta → sus ids (sin las de sistema); los que no existen, aparte. */
async function tagIdsByName(organizationId: string, names: readonly string[]) {
  const all = await listTags(organizationId);
  const byName = new Map(all.map((t) => [t.name.toLocaleLowerCase("es"), t]));
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const n of names) {
    const t = byName.get(n.trim().toLocaleLowerCase("es"));
    if (t) ids.push(t.id);
    else unknown.push(n);
  }
  return { ids, unknown, all };
}

function unknownTags(unknown: string[], all: { name: string }[]): ToolOutcome {
  return fail(
    `No existen estas etiquetas: ${unknown.join(", ")}. Las que hay: ${all.map((t) => t.name).join(", ") || "ninguna"}`,
    "etiqueta desconocida"
  );
}

const campaignsOn = (org: string) => orgHasModule(org, "campaigns");
const agentsOn = async (org: string) => (await orgHasModule(org, "lab")) && (await orgHasModule(org, "agent"));

/* ============================== Contactos ============================== */

const exportArgs = z.object({
  query: z.string().trim().max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  source: z.enum(SOURCE_FILTER_VALUES).optional(),
  stage: z.string().trim().max(60).optional(),
  include_archived: z.boolean().default(false),
});

const exportContacts: ToolSpec<z.infer<typeof exportArgs>> = {
  name: "export_contacts",
  title: "Exportar contactos",
  description: `Exporta en CSV los contactos que ve la persona (nombre, teléfono, fuente, consentimiento, etiquetas, etapa). Filtra por texto, etiquetas (al menos una), fuente o etapa. Hasta ${AI_EXPORT_MAX} contactos; si son más, filtra. Cada exportación queda anotada.`,
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Nombre o teléfono" },
      tags: { type: "array", items: { type: "string" }, maxItems: 20 },
      source: { type: "string", enum: [...SOURCE_FILTER_VALUES] },
      stage: { type: "string", description: "Nombre de la etapa (list_stages)" },
      include_archived: { type: "boolean" },
    },
    additionalProperties: false,
  },
  parse: exportArgs,
  scope: "read",
  permission: "contacts.export",
  area: "contacts",
  run: async ({ session }, args) => {
    const tags = await tagIdsByName(session.organizationId, args.tags);
    if (tags.unknown.length > 0) return unknownTags(tags.unknown, tags.all);
    const res = await exportContactsCsv(
      session,
      {
        q: args.query,
        stage: args.stage,
        includeArchived: args.include_archived,
        filter: { tagIds: tags.ids.length ? tags.ids : undefined, source: args.source },
      },
      AI_EXPORT_MAX
    );
    if (!res.ok) {
      return fail(`Son más de ${AI_EXPORT_MAX} contactos: filtra por etiqueta, fuente o etapa.`, "demasiados contactos");
    }
    return { data: { ok: true, count: res.count, csv: res.csv }, summary: `exportó ${res.count} contactos` };
  },
};

const importArgs = z.object({
  contacts: z
    .array(
      z.object({
        name: z.string().trim().max(120).default(""),
        phone: z.string().trim().min(1).max(40),
        tags: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
      })
    )
    .min(1)
    .max(AI_IMPORT_MAX),
  consent: z.enum(CONSENT_ANSWERS as ["yes", "unknown"]),
  tag_name: z.string().trim().max(60).optional(),
  create_leads: z.boolean().default(false),
});

const importContactsTool: ToolSpec<z.infer<typeof importArgs>> = {
  name: "import_contacts",
  title: "Importar contactos",
  description: `Crea o actualiza hasta ${AI_IMPORT_MAX} contactos (nombre, teléfono y etiquetas). OBLIGATORIO consent: "yes" solo si esas personas aceptaron recibir WhatsApp del negocio; si no lo sabes, "unknown" (no recibirán campañas). Quien pidió no recibir mensajes se respeta siempre. Todos quedan con la etiqueta tag_name (o «Import: IA»).`,
  inputSchema: {
    type: "object",
    properties: {
      contacts: {
        type: "array",
        maxItems: AI_IMPORT_MAX,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string", description: "Con lada; p. ej. +52 462 123 4567" },
            tags: { type: "array", items: { type: "string" }, maxItems: 10 },
          },
          required: ["phone"],
          additionalProperties: false,
        },
      },
      consent: { type: "string", enum: ["yes", "unknown"] },
      tag_name: { type: "string" },
      create_leads: { type: "boolean", description: "Crear su tarjeta en la primera etapa" },
    },
    required: ["contacts", "consent"],
    additionalProperties: false,
  },
  parse: importArgs,
  scope: "write",
  permission: "contacts.import",
  area: "contacts",
  serial: true,
  run: async ({ session }, args) => {
    const text = toCsv(
      ["name", "phone", "tags"],
      // Solo dígitos: `toCsv` protege un «+» inicial como fórmula y la importación lo rechazaría.
      args.contacts.map((c) => [c.name, c.phone.replace(/\D/g, ""), c.tags.join("|")])
    );
    try {
      const s = await importContacts({
        organizationId: session.organizationId,
        actorUserId: session.userId,
        fileName: "IA",
        text,
        tagName: args.tag_name ?? null,
        createLeads: args.create_leads,
        consentAnswer: args.consent,
        optOutTreatment: "respect",
      });
      return {
        data: {
          ok: true,
          created: s.created,
          updated: s.updated,
          failed: s.failed,
          tag: s.tag.name,
          failures: s.failures.slice(0, 20),
        },
        summary: `importó ${s.created + s.updated} contactos (${s.failed} con error)`,
      };
    } catch (err) {
      if (err instanceof ImportError) return fail(err.message, "no se importó");
      throw err;
    }
  },
};

/* ============================== Campañas ============================== */

const empty = z.object({}).strict();
const emptySchema = { type: "object", properties: {}, additionalProperties: false };

async function sendableTemplates(organizationId: string) {
  const rows = await getDb()
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, organizationId, eq(schema.template.status, "approved")));
  return rows.filter((t) => templateSendability(t).sendable);
}

const listTemplatesTool: ToolSpec<z.infer<typeof empty>> = {
  name: "list_templates",
  title: "Ver plantillas para campañas",
  description: "Las plantillas aprobadas por Meta que se pueden usar en una campaña, con su texto y sus variables {{1}}…",
  inputSchema: emptySchema,
  parse: empty,
  scope: "read",
  permission: "campaigns.manage",
  area: "campaigns",
  available: campaignsOn,
  run: async ({ session }) => {
    const rows = await sendableTemplates(session.organizationId);
    return {
      data: {
        templates: rows.map((t) => ({ id: t.id, name: t.name, language: t.language, category: t.category, body: t.body })),
      },
      summary: `${rows.length} plantillas`,
    };
  },
};

const listCampaignsTool: ToolSpec<z.infer<typeof empty>> = {
  name: "list_campaigns",
  title: "Ver campañas",
  description: "Las últimas 30 campañas con su estado (draft = lista para lanzar), destinatarios y entregas.",
  inputSchema: emptySchema,
  parse: empty,
  scope: "read",
  permission: "campaigns.manage",
  area: "campaigns",
  available: campaignsOn,
  run: async ({ session }) => {
    const rows = (await listCampaigns(session.organizationId)).slice(0, 30);
    return {
      data: {
        campaigns: rows.map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          template: c.template?.name ?? null,
          total: c.total,
          sent: c.counts.sent,
          delivered: c.delivery.delivered,
          read: c.delivery.read,
          failed: c.delivery.failed,
          created_at: c.createdAt,
          scheduled_at: c.scheduledAt,
          link: `/campaigns/${c.id}`,
        })),
      },
      summary: `${rows.length} campañas`,
    };
  },
};

const variableArg = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), value: z.string().max(500) }),
  z.object({ kind: z.literal("contact_name") }),
]);

const prepareArgs = z.object({
  name: z.string().trim().min(1).max(120),
  template: z.string().trim().min(1).max(200),
  variables: z.array(variableArg).max(20).default([]),
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  source: z.enum(SOURCE_FILTER_VALUES).optional(),
});

const prepareCampaign: ToolSpec<z.infer<typeof prepareArgs>> = {
  name: "prepare_campaign",
  title: "Preparar una campaña",
  description:
    "Deja una campaña LISTA (borrador) con una plantilla de list_templates (por nombre o id) para los contactos con consentimiento que lleven alguna de las etiquetas (o de esa fuente). Una variable por cada {{n}} de la plantilla, en orden: texto fijo o el nombre del contacto. No envía nada: una persona la revisa y la lanza con un clic.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      template: { type: "string", description: "Nombre o id de la plantilla" },
      variables: {
        type: "array",
        maxItems: 20,
        items: {
          oneOf: [
            {
              type: "object",
              properties: { kind: { const: "fixed" }, value: { type: "string" } },
              required: ["kind", "value"],
            },
            { type: "object", properties: { kind: { const: "contact_name" } }, required: ["kind"] },
          ],
        },
      },
      tags: { type: "array", items: { type: "string" }, maxItems: 20 },
      source: { type: "string", enum: [...SOURCE_FILTER_VALUES] },
    },
    required: ["name", "template"],
    additionalProperties: false,
  },
  parse: prepareArgs,
  scope: "write",
  permission: "campaigns.manage",
  area: "campaigns",
  available: campaignsOn,
  run: async ({ session }, args) => {
    const org = session.organizationId;
    const templates = await sendableTemplates(org);
    const wanted = args.template.toLocaleLowerCase("es");
    const template = templates.find((t) => t.id === args.template) ?? templates.find((t) => t.name.toLocaleLowerCase("es") === wanted);
    if (!template) {
      return fail(
        `No hay una plantilla aprobada con ese nombre. Las que hay: ${templates.map((t) => t.name).join(", ") || "ninguna"}`,
        "plantilla desconocida"
      );
    }
    const tags = await tagIdsByName(org, args.tags);
    if (tags.unknown.length > 0) return unknownTags(tags.unknown, tags.all);
    const audience = { ...(tags.ids.length ? { tagIds: tags.ids } : {}), ...(args.source ? { source: args.source } : {}) };
    try {
      const campaign = await createCampaign({
        organizationId: org,
        userId: session.userId,
        name: args.name,
        templateId: template.id,
        variables: args.variables,
        audience,
      });
      const preview = await previewCampaign(org, { audience, templateId: template.id, variables: args.variables });
      return {
        data: {
          ok: true,
          campaign_id: campaign.id,
          status: "draft",
          recipients: preview.eligible,
          excluded: preview.excluded,
          estimated_cost: preview.estimate,
          link: `/campaigns/${campaign.id}`,
          next: "Lista. Una persona la revisa y la lanza con «Enviar ahora».",
        },
        summary: `preparó una campaña para ${preview.eligible} contactos`,
      };
    } catch (err) {
      if (err instanceof CampaignError) return fail(err.message, `no se preparó (${err.code})`);
      throw err;
    }
  },
};

const launchArgs = z.object({
  campaign_id: z.string().min(1).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

const launchCampaignTool: ToolSpec<z.infer<typeof launchArgs>> = {
  name: "launch_campaign",
  title: "Lanzar una campaña",
  description:
    "Lanza una campaña en borrador: ahora, o programada con date (AAAA-MM-DD) y time (HH:MM) en la hora del negocio. Sale a clientes reales: confirma con la persona antes.",
  inputSchema: {
    type: "object",
    properties: { campaign_id: { type: "string" }, date: { type: "string" }, time: { type: "string" } },
    required: ["campaign_id"],
    additionalProperties: false,
  },
  parse: launchArgs,
  scope: "write",
  permission: "campaigns.manage",
  area: "campaigns",
  launch: true,
  serial: true,
  available: campaignsOn,
  run: async ({ session }, args) => {
    const org = session.organizationId;
    let scheduledAt: Date | null = null;
    if (args.date || args.time) {
      if (!args.date || !args.time) return fail("Para programarla manda date y time juntos.", "fecha incompleta");
      scheduledAt = zonedWallClockToUtc(args.date, args.time, await businessTimezone(org));
      if (!scheduledAt) return fail("Fecha u hora no válida.", "fecha no válida");
    }
    try {
      const c = await launchCampaign(org, args.campaign_id, { scheduledAt });
      return {
        data: { ok: true, status: c.status, scheduled_at: c.scheduledAt, total: c.total, link: `/campaigns/${c.id}` },
        summary: scheduledAt ? "programó una campaña" : `lanzó una campaña (${c.total})`,
      };
    } catch (err) {
      if (err instanceof CampaignError) return fail(err.message, `no se lanzó (${err.code})`);
      throw err;
    }
  },
};

/* ============================== Etiquetas ============================== */

const colorArg = z.enum(TAG_COLORS);

const createTagArgs = z.object({ name: z.string().trim().min(1).max(60), color: colorArg.optional() });

const createTagTool: ToolSpec<z.infer<typeof createTagArgs>> = {
  name: "create_tag",
  title: "Crear una etiqueta",
  description: "Crea una etiqueta de contactos nueva.",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" }, color: { type: "string", enum: [...TAG_COLORS] } },
    required: ["name"],
    additionalProperties: false,
  },
  parse: createTagArgs,
  scope: "write",
  permission: "tags.manage",
  area: "tags",
  run: async ({ session }, args) => {
    try {
      const tag = await createTag(session.organizationId, { name: args.name, color: args.color ?? null });
      return { data: { ok: true, tag: { name: tag.name, color: tag.color } }, summary: `creó la etiqueta «${tag.name}»` };
    } catch (err) {
      if (err instanceof TagError) return fail(err.message, "no se creó la etiqueta");
      throw err;
    }
  },
};

const updateTagArgs = z
  .object({ name: z.string().trim().min(1).max(60), new_name: z.string().trim().min(1).max(60).optional(), color: colorArg.optional() })
  .refine((a) => a.new_name !== undefined || a.color !== undefined, "Indica new_name o color");

const updateTagTool: ToolSpec<z.infer<typeof updateTagArgs>> = {
  name: "update_tag",
  title: "Editar una etiqueta",
  description: "Cambia el nombre o el color de una etiqueta (por su nombre actual). No borra etiquetas.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      new_name: { type: "string" },
      color: { type: "string", enum: [...TAG_COLORS] },
    },
    required: ["name"],
    additionalProperties: false,
  },
  parse: updateTagArgs,
  scope: "write",
  permission: "tags.manage",
  area: "tags",
  run: async ({ session }, args) => {
    const found = await tagIdsByName(session.organizationId, [args.name]);
    const id = found.ids[0];
    if (!id) return unknownTags([args.name], found.all);
    try {
      const tag = await updateTag(session.organizationId, id, { name: args.new_name, color: args.color });
      return { data: { ok: true, tag: { name: tag.name, color: tag.color } }, summary: `editó la etiqueta «${tag.name}»` };
    } catch (err) {
      if (err instanceof TagError) return fail(err.message, "no se editó la etiqueta");
      throw err;
    }
  },
};

const tagContactsArgs = z.object({
  tag: z.string().trim().min(1).max(60),
  contact_ids: z.array(z.string().min(1).max(60)).min(1).max(500),
  remove: z.boolean().default(false),
});

const tagContactsTool: ToolSpec<z.infer<typeof tagContactsArgs>> = {
  name: "tag_contacts",
  title: "Etiquetar varios contactos",
  description:
    "Pone (o con remove=true quita) una etiqueta a varios contactos a la vez, por sus ids (los de list_chats o read_chat). Solo cuenta los contactos que la persona ve.",
  inputSchema: {
    type: "object",
    properties: {
      tag: { type: "string" },
      contact_ids: { type: "array", items: { type: "string" }, maxItems: 500 },
      remove: { type: "boolean" },
    },
    required: ["tag", "contact_ids"],
    additionalProperties: false,
  },
  parse: tagContactsArgs,
  scope: "write",
  permission: "tags.manage",
  area: "tags",
  run: async ({ session }, args) => {
    const found = await tagIdsByName(session.organizationId, [args.tag]);
    const tagId = found.ids[0];
    if (!tagId) return unknownTags([args.tag], found.all);
    const visible = await getDb()
      .select({ id: schema.contact.id })
      .from(schema.contact)
      .where(scopedContacts(schema.contact.organizationId, session.access, schema.contact.id, inArray(schema.contact.id, args.contact_ids)));
    const ids = visible.map((v) => v.id);
    try {
      const changed = await tagContactsInBulk(session.organizationId, tagId, ids, args.remove ? "remove" : "add", session.userId);
      return {
        data: { ok: true, changed, not_found: args.contact_ids.length - ids.length },
        summary: `${args.remove ? "quitó" : "puso"} «${args.tag}» a ${changed} contactos`,
      };
    } catch (err) {
      if (err instanceof TagError) return fail(err.message, "no se etiquetó");
      throw err;
    }
  },
};

/* ============================== Agentes ============================== */

const listAgentsTool: ToolSpec<z.infer<typeof empty>> = {
  name: "list_agents",
  title: "Ver agentes de IA",
  description: "Los agentes de IA que contestan a los clientes: nombre, si es el general, si tiene cambios sin publicar y si está en pausa.",
  inputSchema: emptySchema,
  parse: empty,
  scope: "read",
  permission: "agent.manage",
  area: "agents",
  available: agentsOn,
  run: async ({ session }) => {
    const rows = await listAgents(session.organizationId);
    return {
      data: {
        agents: rows.map((a) => ({
          id: a.id,
          name: a.internalName,
          display_name: a.displayName,
          general: a.isGeneral,
          status: a.status,
          paused: a.paused,
        })),
      },
      summary: `${rows.length} agentes`,
    };
  },
};

const agentIdArgs = z.object({ agent_id: z.string().min(1).max(60) });

function configView(c: { displayName: string | null; tone: string | null; greeting: string | null; instructions: string | null; escalationRules: string | null }) {
  return {
    display_name: c.displayName,
    tone: c.tone,
    greeting: c.greeting,
    instructions: c.instructions,
    escalation_rules: c.escalationRules,
  };
}

const readAgentTool: ToolSpec<z.infer<typeof agentIdArgs>> = {
  name: "read_agent",
  title: "Leer un agente de IA",
  description: "El borrador y lo publicado de un agente: nombre, tono, saludo, instrucciones y cuándo pasar a una persona.",
  inputSchema: { type: "object", properties: { agent_id: { type: "string" } }, required: ["agent_id"], additionalProperties: false },
  parse: agentIdArgs,
  scope: "read",
  permission: "agent.manage",
  area: "agents",
  available: agentsOn,
  run: async ({ session }, args) => {
    const a = await getAgent(session.organizationId, args.agent_id);
    if (!a) return fail("No existe ese agente.", "agente no encontrado");
    return {
      data: {
        id: a.id,
        name: a.internalName,
        status: a.status,
        draft: configView(a.draft),
        published: a.published ? configView(a.published) : null,
      },
      summary: `leyó el agente «${a.internalName}»`,
    };
  },
};

const text = (max: number) => z.string().max(max).nullable().optional();
const updateAgentArgs = z.object({
  agent_id: z.string().min(1).max(60),
  display_name: text(60),
  tone: text(500),
  greeting: text(1000),
  instructions: text(8000),
  escalation_rules: text(4000),
});

const updateAgentDraftTool: ToolSpec<z.infer<typeof updateAgentArgs>> = {
  name: "update_agent_draft",
  title: "Editar el borrador de un agente",
  description:
    "Cambia el BORRADOR de un agente (solo los campos que mandes; null los vacía). Los clientes no lo ven hasta que una persona lo publique en Estudio de IA.",
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string" },
      display_name: { type: ["string", "null"], maxLength: 60 },
      tone: { type: ["string", "null"], maxLength: 500 },
      greeting: { type: ["string", "null"], maxLength: 1000 },
      instructions: { type: ["string", "null"], maxLength: 8000 },
      escalation_rules: { type: ["string", "null"], maxLength: 4000 },
    },
    required: ["agent_id"],
    additionalProperties: false,
  },
  parse: updateAgentArgs,
  scope: "write",
  permission: "agent.manage",
  area: "agents",
  available: agentsOn,
  run: async ({ session }, args) => {
    const a = await getAgent(session.organizationId, args.agent_id);
    if (!a) return fail("No existe ese agente.", "agente no encontrado");
    const pick = <T,>(v: T | undefined, old: T) => (v === undefined ? old : v);
    try {
      const saved = await saveDraft(session.organizationId, a.id, {
        ...a.draft,
        displayName: pick(args.display_name, a.draft.displayName),
        tone: pick(args.tone, a.draft.tone),
        greeting: pick(args.greeting, a.draft.greeting),
        instructions: pick(args.instructions, a.draft.instructions),
        escalationRules: pick(args.escalation_rules, a.draft.escalationRules),
      });
      return {
        data: {
          ok: true,
          status: saved.status,
          draft: configView(saved.draft),
          link: `/lab/agents/${saved.id}`,
          next: "Guardado como borrador. Una persona lo prueba y lo publica en Estudio de IA.",
        },
        summary: `editó el borrador de «${saved.internalName}»`,
      };
    } catch (err) {
      if (err instanceof AgentError) return fail(err.message, "no se guardó el borrador");
      throw err;
    }
  },
};

/* ============================== Algunos ajustes ============================== */

const createQuickArgs = z.object({ shortcut: z.string().trim().min(1).max(40), body: z.string().trim().min(1).max(BODY_MAX) });

const createQuickReplyTool: ToolSpec<z.infer<typeof createQuickArgs>> = {
  name: "create_quick_reply",
  title: "Crear una respuesta rápida",
  description: "Crea una respuesta rápida del equipo (se usa con /atajo en el chat; {nombre} pone el nombre del contacto).",
  inputSchema: {
    type: "object",
    properties: { shortcut: { type: "string" }, body: { type: "string" } },
    required: ["shortcut", "body"],
    additionalProperties: false,
  },
  parse: createQuickArgs,
  scope: "write",
  permission: "templates.manage",
  area: "settings",
  run: async ({ session }, args) => {
    const shortcut = normalizeShortcut(args.shortcut);
    if (!shortcut) return fail("El atajo va en minúsculas, sin espacios ni acentos.", "atajo no válido");
    const r = await createQuickReply(session.organizationId, session.userId, { shortcut, body: args.body });
    if (r === "duplicate") return fail(`Ya hay una respuesta con el atajo /${shortcut}`, "atajo repetido");
    return { data: { ok: true, shortcut: r.shortcut }, summary: `creó la respuesta /${r.shortcut}` };
  },
};

const updateQuickArgs = z
  .object({
    shortcut: z.string().trim().min(1).max(40),
    new_shortcut: z.string().trim().min(1).max(40).optional(),
    body: z.string().trim().min(1).max(BODY_MAX).optional(),
  })
  .refine((a) => a.new_shortcut !== undefined || a.body !== undefined, "Indica new_shortcut o body");

const updateQuickReplyTool: ToolSpec<z.infer<typeof updateQuickArgs>> = {
  name: "update_quick_reply",
  title: "Editar una respuesta rápida",
  description: "Cambia el texto o el atajo de una respuesta rápida (por su atajo actual). No las borra.",
  inputSchema: {
    type: "object",
    properties: { shortcut: { type: "string" }, new_shortcut: { type: "string" }, body: { type: "string" } },
    required: ["shortcut"],
    additionalProperties: false,
  },
  parse: updateQuickArgs,
  scope: "write",
  permission: "templates.manage",
  area: "settings",
  run: async ({ session }, args) => {
    const current = normalizeShortcut(args.shortcut);
    const found = (await listQuickReplies(session.organizationId)).find((q) => q.shortcut === current);
    if (!found) return fail(`No hay una respuesta con el atajo /${current}`, "respuesta no encontrada");
    const next = args.new_shortcut !== undefined ? normalizeShortcut(args.new_shortcut) : undefined;
    if (next === "") return fail("El atajo va en minúsculas, sin espacios ni acentos.", "atajo no válido");
    const r = await updateQuickReply(session.organizationId, found.id, { shortcut: next, body: args.body });
    if (r === "duplicate") return fail(`Ya hay una respuesta con el atajo /${next}`, "atajo repetido");
    if (!r) return fail("Esa respuesta ya no existe.", "respuesta no encontrada");
    return { data: { ok: true, shortcut: r.shortcut }, summary: `editó la respuesta /${r.shortcut}` };
  },
};

const lossLabel = z.string().trim().min(1).max(LABEL_MAX);

const createLossReasonTool: ToolSpec<{ label: string }> = {
  name: "create_loss_reason",
  title: "Agregar un motivo de pérdida",
  description: "Agrega un motivo para cuando un lead se pierde.",
  inputSchema: { type: "object", properties: { label: { type: "string" } }, required: ["label"], additionalProperties: false },
  parse: z.object({ label: lossLabel }),
  scope: "write",
  permission: "pipeline.edit",
  area: "settings",
  run: async ({ session }, args) => {
    const existing = await listLossReasons(session.organizationId);
    if (existing.some((r) => r.active && r.label.toLocaleLowerCase("es") === args.label.toLocaleLowerCase("es"))) {
      return fail(`Ya existe el motivo «${args.label}».`, "motivo repetido");
    }
    const r = await createLossReason(session.organizationId, args.label);
    return { data: { ok: true, label: r.label }, summary: `agregó el motivo «${r.label}»` };
  },
};

const renameLossArgs = z.object({ label: lossLabel, new_label: lossLabel });

const renameLossReasonTool: ToolSpec<z.infer<typeof renameLossArgs>> = {
  name: "rename_loss_reason",
  title: "Renombrar un motivo de pérdida",
  description: "Cambia el nombre de un motivo de pérdida (por su nombre actual). No los quita.",
  inputSchema: {
    type: "object",
    properties: { label: { type: "string" }, new_label: { type: "string" } },
    required: ["label", "new_label"],
    additionalProperties: false,
  },
  parse: renameLossArgs,
  scope: "write",
  permission: "pipeline.edit",
  area: "settings",
  run: async ({ session }, args) => {
    const all = await listLossReasons(session.organizationId);
    const found = all.find((r) => r.active && r.label.toLocaleLowerCase("es") === args.label.toLocaleLowerCase("es"));
    if (!found) {
      return fail(
        `No existe el motivo «${args.label}». Los que hay: ${all.filter((r) => r.active).map((r) => r.label).join(", ")}`,
        "motivo no encontrado"
      );
    }
    const r = await updateLossReason(session.organizationId, found.id, { label: args.new_label });
    if (!r || r === "protected") return fail("Ese motivo ya no existe.", "motivo no encontrado");
    return { data: { ok: true, label: r.label }, summary: `renombró un motivo a «${r.label}»` };
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cada herramienta valida sus propios argumentos
export const ADVANCED_TOOLS: readonly ToolSpec<any>[] = [
  exportContacts,
  importContactsTool,
  listTemplatesTool,
  listCampaignsTool,
  prepareCampaign,
  launchCampaignTool,
  createTagTool,
  updateTagTool,
  tagContactsTool,
  listAgentsTool,
  readAgentTool,
  updateAgentDraftTool,
  createQuickReplyTool,
  updateQuickReplyTool,
  createLossReasonTool,
  renameLossReasonTool,
];
