import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { MAX_QUERIES_PER_QUESTION, quarantineString, type Masker } from "@/lib/assistant-engine";
import { roleLabel } from "@/lib/auth/permissions";
import { getDb, schema } from "@/lib/db";
import { scoped, scopedContacts, type Access } from "@/lib/db/tenant";
import { AI_KIND_LABEL, formatStorage, STORAGE_CATEGORY_LABEL, type AiUsageKind, type StorageCategory } from "@/lib/usage";
import { GAUGE_STATE_LABEL, type Gauge } from "@/lib/usage-visibility";
import { PLATFORM_MODULE_LABEL, PLATFORM_MODULE_TOGGLES } from "@/lib/platform-modules";
import { USAGE_VISIBILITY_LABEL } from "@/lib/limits";
import { notLabContact } from "@/server/analytics/shared";
import { moduleToggles } from "@/server/limits";
import { getOrgModules } from "@/server/modules";
import { getOwnerUsage, type OwnerUsage } from "@/server/usage/owner";

/**
 * 038 (PR 2) — El CATÁLOGO CERRADO del asistente interno. El modelo nunca
 * escribe SQL: solo pide consultas de esta lista, por nombre y con parámetros
 * validados con Zod. Cada una es SOLO LECTURA, a nombre de la organización de
 * la sesión (pool de la app → RLS de `app.org_id`, más `scoped()` /
 * `scopedContacts()` en cada sentencia).
 *
 * Cada consulta devuelve dos cosas:
 * - `forModel`: lo que ve el modelo, con los nombres de contactos y personas
 *   del equipo, teléfonos y correos ENMASCARADOS (`Masker`) y el texto libre
 *   en cuarentena (`quarantineString`); el motor lo delimita como DATOS.
 * - `forOwner`: lo mismo con los datos reales, que el Propietario ve como la
 *   FUENTE de la respuesta.
 *
 * El consumo de IA sale de `getOwnerUsage`, ya recortado a la visibilidad que
 * fijó el administrador (038 PR 1): con `percent` no hay tokens que contar,
 * con `status` ni porcentajes. Nunca dólares.
 */

export type QueryContext = { organizationId: string; access: Access; masker: Masker; now: Date };
export type QueryOutput = { forModel: unknown; forOwner: unknown };

type QueryDef<A extends z.ZodTypeAny> = {
  name: string;
  /** Lo que ve el Propietario en «Fuentes». */
  label: string;
  /** Lo que lee el modelo para decidir si le sirve. */
  description: string;
  args: A;
  /** Cómo se le describen los parámetros al modelo («ninguno» si no lleva). */
  argsHelp: string;
  run: (ctx: QueryContext, args: z.infer<A>) => Promise<QueryOutput>;
};

const noArgs = z.object({}).strict();
const limitArgs = (def: number, max: number) =>
  z.object({ limite: z.coerce.number().int().min(1).max(max).default(def) }).strict();

/** Una lectura de «Uso y plan» por pregunta, aunque la pidan varias consultas. */
const usageMemo = new WeakMap<QueryContext, Promise<OwnerUsage>>();
function usage(ctx: QueryContext): Promise<OwnerUsage> {
  let p = usageMemo.get(ctx);
  if (!p) {
    p = getOwnerUsage(ctx.organizationId, ctx.now);
    usageMemo.set(ctx, p);
  }
  return p;
}

function gaugeOut(g: Gauge | null) {
  if (!g) return null;
  return {
    estado: GAUGE_STATE_LABEL[g.state],
    porcentaje_del_tope: g.percent,
    ...(g.used !== undefined ? { tokens_usados: g.used, tope_tokens: g.limit ?? null } : {}),
  };
}

/** Las consultas que no traen datos personales: lo mismo para el modelo y el Propietario. */
const same = (data: unknown): QueryOutput => ({ forModel: data, forOwner: data });

const QUERIES = [
  {
    name: "consumo_ia",
    label: "Consumo de IA del mes",
    description:
      "Cuánto lleva consumido la organización este mes de su IA (total), de los embeddings de documentos y del crédito del asistente interno, contra sus topes. Según la visibilidad que fijó la plataforma trae porcentaje del tope, solo el estado («Disponible», «Queda poco», «Agotado») o también tokens.",
    args: noArgs,
    argsHelp: "ninguno",
    run: async (ctx) => {
      const u = await usage(ctx);
      return same({
        periodo: u.period,
        visibilidad: USAGE_VISIBILITY_LABEL[u.visibility],
        ia_total: {
          ...gaugeOut(u.ai.total),
          ...(u.ai.total.tokens ? { tokens: u.ai.total.tokens, turnos: u.ai.total.turns } : {}),
        },
        embeddings_documentos: gaugeOut(u.ai.embed),
        asistente_interno: gaugeOut(u.ai.assistant),
      });
    },
  },
  {
    name: "consumo_ia_por_funcion",
    label: "Consumo de IA por función",
    description: "Qué parte del consumo de IA del mes se fue en cada función (agente, Laboratorio, juez, redacción, asistente interno).",
    args: noArgs,
    argsHelp: "ninguno",
    run: async (ctx) => {
      const u = await usage(ctx);
      if (!u.ai.byKind) return same({ disponible: false, motivo: "La visibilidad del consumo de tu organización no muestra el desglose." });
      return same({
        periodo: u.period,
        funciones: u.ai.byKind.map((l) => ({
          funcion: AI_KIND_LABEL[l.key as AiUsageKind] ?? l.key,
          parte_del_total: Math.round(l.share * 1000) / 10,
          ...(l.tokens !== undefined ? { tokens: l.tokens, turnos: l.turns } : {}),
        })),
      });
    },
  },
  {
    name: "consumo_ia_por_agente",
    label: "Consumo de IA por agente",
    description: "Qué parte del consumo de IA del mes usó cada agente de IA (por nombre del agente; los archivados se marcan).",
    args: noArgs,
    argsHelp: "ninguno",
    run: async (ctx) => {
      const u = await usage(ctx);
      if (!u.ai.byAgent) return same({ disponible: false, motivo: "La visibilidad del consumo de tu organización no muestra el desglose." });
      const filas = (nombre: (n: string | null) => string | null) =>
        u.ai.byAgent!.map((a) => ({
          agente: nombre(a.name),
          archivado: a.archived,
          parte_del_total: Math.round(a.share * 1000) / 10,
          ...(a.tokens !== undefined ? { tokens: a.tokens, turnos: a.turns } : {}),
        }));
      return {
        forModel: { periodo: u.period, agentes: filas((n) => (n ? quarantineString(n, 80) : null)) },
        forOwner: { periodo: u.period, agentes: filas((n) => n) },
      };
    },
  },
  {
    name: "almacenamiento",
    label: "Almacenamiento (aprox.)",
    description: "Cuánto espacio ocupan (aproximado) los archivos de la organización, por categoría, y su tope si lo tiene.",
    args: noArgs,
    argsHelp: "ninguno",
    run: async (ctx) => {
      const u = await usage(ctx);
      return same({
        total: formatStorage(u.storage.totalBytes),
        tope: u.limits.storageBytes.value === null ? "sin tope" : formatStorage(u.limits.storageBytes.value),
        al_llegar_al_tope: u.limits.storageMode === "block_uploads" ? "se bloquean las subidas del CRM" : "solo avisa",
        por_categoria: Object.entries(u.storage.byCategory).map(([k, bytes]) => ({
          categoria: STORAGE_CATEGORY_LABEL[k as StorageCategory] ?? k,
          ocupa: formatStorage(bytes),
        })),
        nota: "Es aproximado: no cuenta mensajes ni contactos guardados en la base de datos.",
      });
    },
  },
  {
    name: "plan_y_topes",
    label: "Plan y topes",
    description: "Los topes del plan de la organización (personas del equipo, módulos, almacenamiento, documentos del agente) y cuánto lleva de cada uno.",
    args: noArgs,
    argsHelp: "ninguno",
    run: async (ctx) => {
      const u = await usage(ctx);
      const tope = (v: number | null) => (v === null ? "sin tope" : v);
      return same({
        personas_del_equipo: { usadas: u.members, tope: tope(u.limits.members.value) },
        modulos_activos: { usados: u.modules.active, de: u.modules.total, tope: tope(u.limits.modules.value) },
        documentos_del_agente: u.documents
          ? { documentos: u.documents.documents, tope_documentos: tope(u.limits.kbMaxDocuments.value), fragmentos: u.documents.chunks, tope_fragmentos: tope(u.limits.kbMaxChunks.value) }
          : "la organización no usa documentos del agente",
      });
    },
  },
  {
    name: "avisos_consumo",
    label: "Avisos de consumo del mes",
    description: "Los avisos de consumo de este mes (al 80 % y al 100 % de algún tope), con su fecha.",
    args: noArgs,
    argsHelp: "ninguno",
    run: async (ctx) => {
      const u = await usage(ctx);
      return same({
        periodo: u.period,
        avisos: u.alerts.map((a) => ({ aviso: a.text, fecha: a.createdAt.slice(0, 10) })),
      });
    },
  },
  {
    name: "modulos",
    label: "Módulos de la organización",
    description: "Qué módulos opcionales tiene encendidos y apagados la organización.",
    args: noArgs,
    argsHelp: "ninguno",
    run: async (ctx) => {
      const t = moduleToggles(await getOrgModules(ctx.organizationId));
      return same({
        encendidos: PLATFORM_MODULE_TOGGLES.filter((k) => t[k]).map((k) => PLATFORM_MODULE_LABEL[k]),
        apagados: PLATFORM_MODULE_TOGGLES.filter((k) => !t[k]).map((k) => PLATFORM_MODULE_LABEL[k]),
      });
    },
  },
  {
    name: "equipo",
    label: "Equipo",
    description: "Las personas del equipo (asesores, coordinadores, propietario) con su rol y cuántos contactos tienen asignados. Los nombres llegan enmascarados.",
    args: noArgs,
    argsHelp: "ninguno",
    run: async (ctx) => {
      const db = getDb();
      const miembros = await db
        .select({ userId: schema.member.userId, role: schema.member.role, name: schema.user.name })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(scoped(schema.member.organizationId, ctx.organizationId))
        .orderBy(schema.user.name);
      const asignados = await db
        .select({ userId: schema.contact.assignedUserId, n: count() })
        .from(schema.contact)
        .where(scopedContacts(schema.contact.organizationId, ctx.access, schema.contact.id, notLabContact(schema.contact.id)))
        .groupBy(schema.contact.assignedUserId);
      const porPersona = new Map(asignados.map((a) => [a.userId, Number(a.n)]));
      const fila = (m: (typeof miembros)[number], nombre: string | null) => ({
        persona: nombre,
        rol: roleLabel(m.role),
        contactos_asignados: porPersona.get(m.userId) ?? 0,
      });
      return {
        forModel: { personas: miembros.map((m) => fila(m, ctx.masker.name("member", m.name))) },
        forOwner: { personas: miembros.map((m) => fila(m, m.name)) },
      };
    },
  },
  {
    name: "etiquetas",
    label: "Etiquetas",
    description: "Las etiquetas de contactos (las que crea el equipo, sin las automáticas de importación) con cuántos contactos tiene cada una, de la más usada a la menos.",
    args: limitArgs(20, 50),
    argsHelp: '{"limite": 1-50, opcional, 20 por defecto}',
    run: async (ctx, args) => {
      const db = getDb();
      const tags = await db
        .select({ id: schema.contactTag.id, name: schema.contactTag.name })
        .from(schema.contactTag)
        .where(scoped(schema.contactTag.organizationId, ctx.organizationId, isNull(schema.contactTag.systemOrigin)));
      const uso = await db
        .select({ tagId: schema.contactTagAssignment.tagId, n: count() })
        .from(schema.contactTagAssignment)
        .where(
          scopedContacts(
            schema.contactTagAssignment.organizationId,
            ctx.access,
            schema.contactTagAssignment.contactId,
            notLabContact(schema.contactTagAssignment.contactId)
          )
        )
        .groupBy(schema.contactTagAssignment.tagId);
      const porTag = new Map(uso.map((u) => [u.tagId, Number(u.n)]));
      const filas = tags
        .map((t) => ({ name: t.name, contactos: porTag.get(t.id) ?? 0 }))
        .sort((a, b) => b.contactos - a.contactos || a.name.localeCompare(b.name))
        .slice(0, args.limite);
      return {
        forModel: { total_etiquetas: tags.length, etiquetas: filas.map((f) => ({ etiqueta: quarantineString(ctx.masker.text(f.name), 80), contactos: f.contactos })) },
        forOwner: { total_etiquetas: tags.length, etiquetas: filas.map((f) => ({ etiqueta: f.name, contactos: f.contactos })) },
      };
    },
  },
  {
    name: "conversaciones_por_etapa",
    label: "Leads por etapa del pipeline",
    description: "Cuántos leads hay en cada etapa del pipeline (abiertas, ganadas y perdidas), en el orden del pipeline.",
    args: noArgs,
    argsHelp: "ninguno",
    run: async (ctx) => {
      const db = getDb();
      const etapas = await db
        .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name, kind: schema.pipelineStage.kind })
        .from(schema.pipelineStage)
        .where(scoped(schema.pipelineStage.organizationId, ctx.organizationId))
        .orderBy(schema.pipelineStage.position);
      const leads = await db
        .select({ stageId: schema.lead.stageId, n: count() })
        .from(schema.lead)
        .where(scopedContacts(schema.lead.organizationId, ctx.access, schema.lead.contactId, notLabContact(schema.lead.contactId)))
        .groupBy(schema.lead.stageId);
      const porEtapa = new Map(leads.map((l) => [l.stageId, Number(l.n)]));
      const TIPO = { open: "abierta", won: "ganada", lost: "perdida" } as const;
      const filas = (nombre: (n: string) => string) =>
        etapas.map((e) => ({ etapa: nombre(e.name), tipo: TIPO[e.kind], leads: porEtapa.get(e.id) ?? 0 }));
      return {
        forModel: { etapas: filas((n) => quarantineString(ctx.masker.text(n), 80)) },
        forOwner: { etapas: filas((n) => n) },
      };
    },
  },
  {
    name: "conversaciones_recientes",
    label: "Conversaciones recientes",
    description:
      "Las conversaciones con clientes más recientes (sin archivadas ni de prueba): contacto, canal, etapa, a quién está asignada, si tiene mensajes sin leer y el último mensaje (recortado). Contactos, personas y teléfonos llegan enmascarados.",
    args: limitArgs(5, 10),
    argsHelp: '{"limite": 1-10, opcional, 5 por defecto}',
    run: async (ctx, args) => {
      const db = getDb();
      const ultimo = sql<string | null>`(
        select coalesce(m.text, m.type) from message m
        where m.conversation_id = ${schema.conversation.id}
        order by m.created_at desc limit 1
      )`;
      const ultimoDir = sql<string | null>`(
        select m.direction from message m
        where m.conversation_id = ${schema.conversation.id}
        order by m.created_at desc limit 1
      )`;
      const etapa = sql<string | null>`(
        select s.name from lead l join pipeline_stage s on s.id = l.stage_id
        where l.contact_id = ${schema.contact.id} limit 1
      )`;
      const asignado = sql<string | null>`(
        select u.name from "user" u where u.id = ${schema.contact.assignedUserId}
      )`;
      const rows = await db
        .select({
          contacto: schema.contact.name,
          telefono: schema.contact.phone,
          canal: schema.conversation.channel,
          noLeidos: schema.conversation.unreadCount,
          fecha: sql<Date | null>`coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})`,
          ultimo,
          ultimoDir,
          etapa,
          asignado,
        })
        .from(schema.conversation)
        .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
        .where(
          scopedContacts(
            schema.conversation.organizationId,
            ctx.access,
            schema.conversation.contactId,
            and(eq(schema.conversation.isTest, false), isNull(schema.conversation.archivedAt))
          )
        )
        .orderBy(desc(sql`coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})`))
        .limit(args.limite);

      const owner = rows.map((r) => ({
        contacto: r.contacto,
        telefono: r.telefono,
        canal: r.canal,
        etapa: r.etapa,
        asignado_a: r.asignado ?? "sin asignar",
        sin_leer: r.noLeidos,
        ultimo_mensaje: r.ultimo ? r.ultimo.slice(0, 160) : null,
        ultimo_mensaje_de: r.ultimoDir === "in" ? "cliente" : r.ultimoDir === "out" ? "negocio" : null,
        fecha: r.fecha ? new Date(r.fecha).toISOString().slice(0, 16).replace("T", " ") : null,
      }));
      // Primero los nombres (para reconocerlos dentro de los mensajes), luego el texto.
      const tokens = rows.map((r) => ({
        contacto: ctx.masker.name("contact", r.contacto),
        asignado: r.asignado ? ctx.masker.name("member", r.asignado) : "sin asignar",
        telefono: r.telefono ? ctx.masker.text(r.telefono) : null,
      }));
      const model = owner.map((o, i) => ({
        ...o,
        contacto: tokens[i]!.contacto,
        telefono: tokens[i]!.telefono,
        asignado_a: tokens[i]!.asignado,
        etapa: o.etapa ? quarantineString(ctx.masker.text(o.etapa), 80) : null,
        ultimo_mensaje: o.ultimo_mensaje ? quarantineString(ctx.masker.text(o.ultimo_mensaje), 200) : null,
      }));
      return { forModel: { conversaciones: model }, forOwner: { conversaciones: owner } };
    },
  },
] satisfies QueryDef<z.ZodTypeAny>[];

export type AssistantQueryName = (typeof QUERIES)[number]["name"];
export const ASSISTANT_QUERY_NAMES = QUERIES.map((q) => q.name);

export function findQuery(name: string) {
  return QUERIES.find((q) => q.name === name) ?? null;
}

/** El catálogo como lo lee el modelo en su prompt. */
export function renderCatalog(): string {
  return [
    `CATÁLOGO DE CONSULTAS (las ÚNICAS que existen; hasta ${MAX_QUERIES_PER_QUESTION} por pregunta):`,
    ...QUERIES.map((q) => `- ${q.name} — ${q.description} Parámetros: ${q.argsHelp}.`),
  ].join("\n");
}

export type RunQueryResult =
  | { ok: true; label: string; args: Record<string, unknown>; output: QueryOutput }
  | { ok: false; reason: string };

/** Corre UNA consulta del catálogo con sus parámetros validados. Nunca SQL del modelo. */
export async function runQuery(ctx: QueryContext, name: string, rawArgs: unknown): Promise<RunQueryResult> {
  const q = findQuery(name);
  if (!q) return { ok: false, reason: `la consulta «${name.slice(0, 60)}» no existe en el catálogo` };
  const parsed = (q.args as z.ZodTypeAny).safeParse(rawArgs ?? {});
  if (!parsed.success) return { ok: false, reason: `parámetros inválidos para ${q.name}` };
  const output = await (q.run as (c: QueryContext, a: unknown) => Promise<QueryOutput>)(ctx, parsed.data);
  return { ok: true, label: q.label, args: parsed.data as Record<string, unknown>, output };
}
