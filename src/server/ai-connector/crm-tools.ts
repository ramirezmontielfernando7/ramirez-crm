import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { CLIENT_CONTENT_NOTICE } from "@/lib/ai-connector";
import type { SessionContext } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { companyChat, scoped, scopedContacts } from "@/lib/db/tenant";
import { describeTimelineItem } from "@/lib/timeline";
import { NOTE_BODY_MAX, NOTE_COLORS, NOTE_TITLE_MAX, TASK_DESCRIPTION_MAX, TASK_TITLE_MAX, type NoteDto } from "@/lib/work";
import type { ToolOutcome, ToolSpec } from "@/server/ai-connector/tools";
import { contactTimeline } from "@/server/activity/timeline";
import { upsertFicha } from "@/server/bot/ficha";
import { getBranding } from "@/server/branding";
import { getContactById, getContactStage } from "@/server/contacts";
import { publish } from "@/server/events/bus";
import { getConversation } from "@/server/inbox/queries";
import { leadFieldsPatch, updateLeadFields } from "@/server/leads/fields";
import { orgHasModule } from "@/server/modules";
import { tagsForContacts } from "@/server/tags/tags";
import { createNote, listContactNotes, listMyNotes, NoteInputError, updateNote } from "@/server/work/notes";
import { TaskInputError, updateTask, viewerOf } from "@/server/work/tasks";

/**
 * 047 — Lo de todos los días que la pantalla ya deja hacer a cualquier rol:
 * la ficha del contacto (ver y corregir nombre, notas y datos), el embudo
 * (ver los leads por etapa, monto y prioridad), las tareas (editarlas y
 * marcarlas hechas) y las notas de trabajo. Sin Funciones avanzadas: cada
 * una con las MISMAS puertas y la misma visibilidad que la pantalla (un
 * asesor solo ve y toca lo suyo). Nada borra; el consentimiento no se toca
 * desde aquí.
 */

const MAX_TIMELINE = 30;

function fail(error: string, summary: string, extra: Partial<ToolOutcome> = {}): ToolOutcome {
  return { data: { error }, summary, isError: true, ...extra };
}

const NOT_FOUND = fail("No existe o no tienes acceso a ese contacto", "contacto no encontrado");

function touchedContact(organizationId: string, conversationId: string | null) {
  if (conversationId) publish(organizationId, { type: "conversation.updated", data: { conversation: { id: conversationId } } });
}

/** El contacto de un chat o por su id, solo si quien pide lo ve. */
async function contactOf(session: SessionContext, ref: { conversation_id?: string; contact_id?: string }) {
  if (ref.conversation_id) {
    const found = await getConversation(session.access, ref.conversation_id);
    return found ? { contact: found.contact, conversationId: found.conversation.id } : null;
  }
  if (!ref.contact_id) return null;
  const contact = await getContactById(session.access, ref.contact_id);
  if (!contact) return null;
  const [conv] = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        session.access,
        schema.conversation.contactId,
        eq(schema.conversation.contactId, contact.id),
        companyChat()
      )
    )
    .limit(1);
  return { contact, conversationId: conv?.id ?? null };
}

const refSchema = {
  conversation_id: { type: "string", description: "conversation_id de list_chats" },
  contact_id: { type: "string" },
};
const refRefine = (a: { conversation_id?: string; contact_id?: string }) => Boolean(a.conversation_id || a.contact_id);
const REF_MESSAGE = "Manda conversation_id o contact_id";

function money(cents: number | null, currency: string | null) {
  return cents == null ? null : { amount: cents / 100, currency };
}

/* ============================== Contactos ============================== */

const readContactArgs = z
  .object({ conversation_id: z.string().min(1).max(60).optional(), contact_id: z.string().min(1).max(60).optional() })
  .refine(refRefine, REF_MESSAGE);

const readContact: ToolSpec<z.infer<typeof readContactArgs>> = {
  name: "read_contact",
  title: "Ver la ficha de un contacto",
  description:
    "La ficha completa de un contacto (por conversation_id o contact_id): nombre, teléfono, notas, datos de la ficha, " +
    "consentimiento, etapa, monto y prioridad del lead, etiquetas y la línea de tiempo reciente (notas, etapas, asignaciones).",
  inputSchema: { type: "object", properties: refSchema, additionalProperties: false },
  parse: readContactArgs,
  scope: "read",
  run: async ({ session }, args) => {
    const found = await contactOf(session, args);
    if (!found) return NOT_FOUND;
    const { contact: c } = found;
    const [stage, tags, timeline] = await Promise.all([
      getContactStage(session.access, c.id),
      tagsForContacts(session.organizationId, [c.id]),
      contactTimeline(session.organizationId, c),
    ]);
    return {
      data: {
        notice: CLIENT_CONTENT_NOTICE,
        contact_id: c.id,
        conversation_id: found.conversationId,
        name: c.name,
        phone: c.phone,
        notes: c.notes,
        ficha: c.ficha ?? {},
        consent: c.waConsent,
        marketing_opt_out: c.waMarketingOptOutAt !== null,
        assigned_to_me: c.assignedUserId === session.userId,
        archived: c.archivedAt !== null,
        stage: stage?.stage.name ?? null,
        lead: stage
          ? { amount: money(stage.lead.amountCents, stage.lead.currency), priority: stage.lead.priority }
          : null,
        tags: (tags.get(c.id) ?? []).map((t) => t.name),
        timeline: timeline.slice(0, MAX_TIMELINE).map((item) => {
          const line = describeTimelineItem(item);
          return { at: item.at, title: line.title, body: line.body };
        }),
      },
      summary: "revisó la ficha",
      conversationId: found.conversationId,
      contactId: c.id,
    };
  },
};

const updateContactArgs = z
  .object({
    conversation_id: z.string().min(1).max(60).optional(),
    contact_id: z.string().min(1).max(60).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    notes: z.string().max(4000).nullable().optional(),
    ficha: z.record(z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional(),
  })
  .refine(refRefine, REF_MESSAGE)
  .refine((a) => a.name !== undefined || a.notes !== undefined || a.ficha !== undefined, "Nada que cambiar");

const updateContact: ToolSpec<z.infer<typeof updateContactArgs>> = {
  name: "update_contact",
  title: "Corregir la ficha de un contacto",
  description:
    "Cambia el nombre, las notas fijas o datos de la ficha de un contacto. ficha es un parche: solo las claves que cambian " +
    "(p. ej. {\"carrera\": \"Derecho\"}); null borra una clave. El consentimiento no se cambia desde aquí.",
  inputSchema: {
    type: "object",
    properties: {
      ...refSchema,
      name: { type: "string", maxLength: 120 },
      notes: { type: ["string", "null"], maxLength: 4000 },
      ficha: { type: "object", additionalProperties: { type: ["string", "number", "boolean", "null"] } },
    },
    additionalProperties: false,
  },
  parse: updateContactArgs,
  scope: "write",
  run: async ({ session }, args) => {
    const found = await contactOf(session, args);
    if (!found) return NOT_FOUND;
    const ids = { conversationId: found.conversationId, contactId: found.contact.id };
    // La ficha por su puerta (la misma de la pantalla y del cerebro externo).
    if (args.ficha !== undefined) {
      await upsertFicha({ organizationId: session.organizationId, contactId: found.contact.id, ficha: args.ficha });
    }
    const set: Record<string, unknown> = {};
    if (args.name !== undefined) {
      set.name = args.name;
      // Lo escribió una persona (por su IA): WhatsApp ya no lo pisa (#51).
      set.nameSource = "manual";
    }
    if (args.notes !== undefined) set.notes = args.notes;
    if (Object.keys(set).length > 0) {
      await getDb()
        .update(schema.contact)
        .set({ ...set, updatedAt: new Date() })
        .where(
          scopedContacts(schema.contact.organizationId, session.access, schema.contact.id, eq(schema.contact.id, found.contact.id))
        );
    }
    touchedContact(session.organizationId, found.conversationId);
    const changed = [args.name !== undefined && "nombre", args.notes !== undefined && "notas", args.ficha !== undefined && "ficha"]
      .filter(Boolean)
      .join(", ");
    return { data: { ok: true }, summary: `corrigió ${changed}`, ...ids };
  },
};

/* ============================== Embudo ============================== */

const listPipelineArgs = z.object({
  stage: z.string().trim().min(1).max(80).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

const listPipeline: ToolSpec<z.infer<typeof listPipelineArgs>> = {
  name: "list_pipeline",
  title: "Ver el embudo",
  description:
    "Los leads del embudo (pipeline) que la persona ve, con su etapa, monto, prioridad y quién atiende, más el total por etapa. " +
    "stage (nombre de list_stages) filtra una sola etapa.",
  inputSchema: {
    type: "object",
    properties: { stage: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
    additionalProperties: false,
  },
  parse: listPipelineArgs,
  scope: "read",
  run: async ({ session }, args) => {
    const db = getDb();
    let stageId: string | null = null;
    if (args.stage) {
      const stages = await db
        .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
        .from(schema.pipelineStage)
        .where(scoped(schema.pipelineStage.organizationId, session.organizationId));
      const wanted = args.stage.toLocaleLowerCase("es");
      const s = stages.find((x) => x.name.toLocaleLowerCase("es") === wanted);
      if (!s) return fail(`No hay una etapa «${args.stage}». Las etapas: ${stages.map((x) => x.name).join(", ")}`, "etapa desconocida");
      stageId = s.id;
    }
    const onlyStage = stageId ? [eq(schema.lead.stageId, stageId)] : [];
    const [rows, totals, branding] = await Promise.all([
      db
        .select({
          lead: schema.lead,
          stage: schema.pipelineStage.name,
          contactId: schema.contact.id,
          contactName: schema.contact.name,
          conversationId: schema.conversation.id,
          assignee: sql<string | null>`(select u."name" from "user" u where u."id" = ${schema.contact.assignedUserId})`,
        })
        .from(schema.lead)
        .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
        .innerJoin(schema.pipelineStage, eq(schema.lead.stageId, schema.pipelineStage.id))
        .leftJoin(schema.conversation, and(eq(schema.conversation.contactId, schema.contact.id), companyChat()))
        .where(scopedContacts(schema.lead.organizationId, session.access, schema.lead.contactId, ...onlyStage))
        .orderBy(asc(schema.pipelineStage.position), asc(schema.lead.position))
        .limit(args.limit),
      db
        .select({
          stage: schema.pipelineStage.name,
          kind: schema.pipelineStage.kind,
          leads: sql<number>`count(*)::int`,
          amountCents: sql<number>`coalesce(sum(${schema.lead.amountCents}), 0)::bigint`,
        })
        .from(schema.lead)
        .innerJoin(schema.pipelineStage, eq(schema.lead.stageId, schema.pipelineStage.id))
        .where(scopedContacts(schema.lead.organizationId, session.access, schema.lead.contactId, ...onlyStage))
        .groupBy(schema.pipelineStage.name, schema.pipelineStage.kind, schema.pipelineStage.position)
        .orderBy(asc(schema.pipelineStage.position)),
      getBranding(session.organizationId),
    ]);
    return {
      data: {
        currency: branding.currency,
        stages: totals.map((t) => ({ stage: t.stage, kind: t.kind, leads: t.leads, amount: Number(t.amountCents) / 100 })),
        leads: rows.map((r) => ({
          contact: { id: r.contactId, name: r.contactName },
          conversation_id: r.conversationId,
          stage: r.stage,
          amount: money(r.lead.amountCents, r.lead.currency),
          priority: r.lead.priority,
          assignee: r.assignee,
          last_activity_at: r.lead.lastActivityAt?.toISOString() ?? null,
        })),
      },
      summary: `${rows.length} leads${args.stage ? ` en ${args.stage}` : ""}`,
    };
  },
};

const updateLeadArgs = z
  .object({
    conversation_id: z.string().min(1).max(60).optional(),
    contact_id: z.string().min(1).max(60).optional(),
    amount: z.number().min(0).max(1_000_000_000).nullable().optional(),
    priority: z.enum(["alta", "media", "baja"]).nullable().optional(),
  })
  .refine(refRefine, REF_MESSAGE)
  .refine((a) => a.amount !== undefined || a.priority !== undefined, "Manda amount o priority");

const updateLead: ToolSpec<z.infer<typeof updateLeadArgs>> = {
  name: "update_lead",
  title: "Poner monto o prioridad a un lead",
  description:
    "Guarda el monto del trato (en la moneda del negocio, p. ej. 1500.50; null lo borra) o la prioridad (alta, media, baja; null la quita) " +
    "del lead de un contacto. Para cambiar de etapa usa move_stage.",
  inputSchema: {
    type: "object",
    properties: {
      ...refSchema,
      amount: { type: ["number", "null"], minimum: 0 },
      priority: { type: ["string", "null"], enum: ["alta", "media", "baja", null] },
    },
    additionalProperties: false,
  },
  parse: updateLeadArgs,
  scope: "write",
  run: async ({ session }, args) => {
    const found = await contactOf(session, args);
    if (!found) return NOT_FOUND;
    const ids = { conversationId: found.conversationId, contactId: found.contact.id };
    const stage = await getContactStage(session.access, found.contact.id);
    if (!stage) return fail("Ese contacto no tiene lead en el embudo", "sin lead", ids);
    const extra = await leadFieldsPatch(session.organizationId, {
      ...(args.amount !== undefined ? { amountCents: args.amount === null ? null : Math.round(args.amount * 100) } : {}),
      ...(args.priority !== undefined ? { priority: args.priority } : {}),
    });
    const updated = await updateLeadFields(session.access, stage.lead.id, extra);
    if (!updated) return NOT_FOUND;
    touchedContact(session.organizationId, found.conversationId);
    return {
      data: { ok: true, amount: money(updated.amountCents, updated.currency), priority: updated.priority },
      summary: [args.amount !== undefined && "monto", args.priority !== undefined && "prioridad"].filter(Boolean).join(" y "),
      ...ids,
    };
  },
};

/* ============================== Tareas ============================== */

const workOn = (org: string) => orgHasModule(org, "trabajo");

const updateTaskArgs = z
  .object({
    task_id: z.string().min(1).max(60),
    title: z.string().trim().min(1).max(TASK_TITLE_MAX).optional(),
    description: z.string().trim().max(TASK_DESCRIPTION_MAX).nullable().optional(),
    due_at: z.string().datetime({ offset: true }).nullable().optional(),
    done: z.boolean().optional(),
  })
  .refine((a) => Object.keys(a).length > 1, "Nada que cambiar");

const updateTaskTool: ToolSpec<z.infer<typeof updateTaskArgs>> = {
  name: "update_task",
  title: "Editar o completar una tarea",
  description:
    "Cambia una tarea (task_id de list_tasks): título, descripción, fecha (ISO 8601 con zona; null la quita) o done=true para " +
    "marcarla hecha (done=false la reabre). Solo las tareas que la persona puede editar.",
  inputSchema: {
    type: "object",
    properties: {
      task_id: { type: "string" },
      title: { type: "string", maxLength: TASK_TITLE_MAX },
      description: { type: ["string", "null"], maxLength: TASK_DESCRIPTION_MAX },
      due_at: { type: ["string", "null"], format: "date-time" },
      done: { type: "boolean" },
    },
    required: ["task_id"],
    additionalProperties: false,
  },
  parse: updateTaskArgs,
  scope: "write",
  available: workOn,
  run: async ({ session }, args) => {
    try {
      const res = await updateTask(viewerOf(session), args.task_id, {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.due_at !== undefined ? { dueAt: args.due_at === null ? null : new Date(args.due_at) } : {}),
        ...(args.done !== undefined ? { done: args.done } : {}),
      });
      if (res === null) return fail("No existe esa tarea o no la puedes ver", "tarea no encontrada");
      if (res === "forbidden") return fail("Esa tarea no la puedes editar", "tarea ajena", { outcome: "denied" });
      return {
        data: { ok: true, done: res.doneAt !== null },
        summary: args.done === true ? "completó una tarea" : args.done === false ? "reabrió una tarea" : "editó una tarea",
        conversationId: res.conversationId,
        contactId: res.contact?.id ?? null,
      };
    } catch (err) {
      if (err instanceof TaskInputError) return fail(err.message, "tarea no válida");
      throw err;
    }
  },
};

/* ============================== Notas de trabajo ============================== */

function noteView(n: NoteDto) {
  return {
    id: n.id,
    title: n.title,
    body: n.body.length > 2000 ? `${n.body.slice(0, 2000)}…` : n.body,
    color: n.color,
    pinned: n.pinned,
    archived: n.archived,
    author: n.author?.name ?? null,
    contact: n.contact,
    conversation_id: n.conversationId,
    updated_at: n.updatedAt,
    can_edit: n.canEdit,
  };
}

const listNotesArgs = z.object({
  conversation_id: z.string().min(1).max(60).optional(),
  contact_id: z.string().min(1).max(60).optional(),
  archived: z.boolean().default(false),
});

const listWorkNotes: ToolSpec<z.infer<typeof listNotesArgs>> = {
  name: "list_work_notes",
  title: "Ver notas de trabajo",
  description:
    "Las notas de trabajo (tipo Keep, internas). Sin chat: las que escribió la persona (archived=true, las archivadas). " +
    "Con conversation_id o contact_id: las del equipo ligadas a ese contacto. Son distintas de las notas de la línea de tiempo (add_note).",
  inputSchema: {
    type: "object",
    properties: { ...refSchema, archived: { type: "boolean", default: false } },
    additionalProperties: false,
  },
  parse: listNotesArgs,
  scope: "read",
  available: workOn,
  run: async ({ session }, args) => {
    const v = viewerOf(session);
    if (args.conversation_id || args.contact_id) {
      const found = await contactOf(session, args);
      if (!found) return NOT_FOUND;
      const notes = (await listContactNotes(v, found.contact.id)) ?? [];
      return {
        data: { notes: notes.map(noteView) },
        summary: `${notes.length} notas del contacto`,
        conversationId: found.conversationId,
        contactId: found.contact.id,
      };
    }
    const notes = await listMyNotes(v, { archived: args.archived });
    return { data: { notes: notes.map(noteView) }, summary: `${notes.length} notas propias` };
  },
};

const createNoteArgs = z.object({
  title: z.string().trim().max(NOTE_TITLE_MAX).optional(),
  body: z.string().max(NOTE_BODY_MAX).default(""),
  color: z.enum(NOTE_COLORS).optional(),
  conversation_id: z.string().min(1).max(60).optional(),
});

const createWorkNote: ToolSpec<z.infer<typeof createNoteArgs>> = {
  name: "create_work_note",
  title: "Crear una nota de trabajo",
  description:
    "Crea una nota de trabajo a nombre de la persona. Sin conversation_id solo la ve ella; ligada a un chat, la ve quien ve ese contacto.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", maxLength: NOTE_TITLE_MAX },
      body: { type: "string", maxLength: NOTE_BODY_MAX },
      color: { type: "string", enum: [...NOTE_COLORS] },
      conversation_id: { type: "string" },
    },
    additionalProperties: false,
  },
  parse: createNoteArgs,
  scope: "write",
  available: workOn,
  run: async ({ session }, args) => {
    try {
      const note = await createNote(viewerOf(session), {
        title: args.title ?? null,
        body: args.body,
        ...(args.color ? { color: args.color } : {}),
        conversationId: args.conversation_id ?? null,
      });
      return {
        data: { ok: true, note_id: note.id },
        summary: "creó una nota de trabajo",
        conversationId: note.conversationId,
        contactId: note.contact?.id ?? null,
      };
    } catch (err) {
      if (err instanceof NoteInputError) return fail(err.message, "nota no válida");
      throw err;
    }
  },
};

const updateNoteArgs = z
  .object({
    note_id: z.string().min(1).max(60),
    title: z.string().trim().max(NOTE_TITLE_MAX).nullable().optional(),
    body: z.string().max(NOTE_BODY_MAX).optional(),
    color: z.enum(NOTE_COLORS).optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((a) => Object.keys(a).length > 1, "Nada que cambiar");

const updateWorkNote: ToolSpec<z.infer<typeof updateNoteArgs>> = {
  name: "update_work_note",
  title: "Editar una nota de trabajo",
  description: "Cambia una nota de trabajo (note_id de list_work_notes): título, texto, color, fijarla o archivarla.",
  inputSchema: {
    type: "object",
    properties: {
      note_id: { type: "string" },
      title: { type: ["string", "null"], maxLength: NOTE_TITLE_MAX },
      body: { type: "string", maxLength: NOTE_BODY_MAX },
      color: { type: "string", enum: [...NOTE_COLORS] },
      pinned: { type: "boolean" },
      archived: { type: "boolean" },
    },
    required: ["note_id"],
    additionalProperties: false,
  },
  parse: updateNoteArgs,
  scope: "write",
  available: workOn,
  run: async ({ session }, args) => {
    try {
      const { note_id, ...patch } = args;
      const res = await updateNote(viewerOf(session), note_id, patch);
      if (res === null) return fail("No existe esa nota o no la puedes ver", "nota no encontrada");
      if (res === "forbidden") return fail("Esa nota no la puedes editar", "nota ajena", { outcome: "denied" });
      return {
        data: { ok: true },
        summary: args.archived === true ? "archivó una nota" : "editó una nota de trabajo",
        conversationId: res.conversationId,
        contactId: res.contact?.id ?? null,
      };
    } catch (err) {
      if (err instanceof NoteInputError) return fail(err.message, "nota no válida");
      throw err;
    }
  },
};

export const CRM_TOOLS = [
  readContact,
  updateContact,
  listPipeline,
  updateLead,
  updateTaskTool,
  listWorkNotes,
  createWorkNote,
  updateWorkNote,
];
