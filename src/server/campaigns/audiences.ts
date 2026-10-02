import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import type { AudienceCounts, AudienceDto, AudiencePreviewDto, PreviewRow } from "@/lib/audiences";
import { importValidated, type ImportSummary } from "@/server/contacts-io/import";
import { readSpreadsheet } from "@/server/contacts-io/spreadsheet";
import {
  detectColumns,
  IMPORT_COLUMNS,
  ImportError,
  missingColumns,
  validateTable,
  type ColumnMapping,
  type ImportColumn,
  type ImportTable,
} from "@/server/contacts-io/validate";

/**
 * Campañas v2 (PR 2) — Audiencias: bases .xlsx/.csv subidas desde Campañas.
 *
 * NO es un importador aparte: lee la hoja (`readSpreadsheet`), la valida con
 * las MISMAS reglas que la importación de Contactos (`validateTable`) y la
 * guarda con el MISMO núcleo (`importValidated`): dedupe por teléfono, opt_out
 * pegajoso, etiqueta automática de origen. Lo propio de Audiencias es:
 * - el paso "¿qué es cada columna?" cuando los encabezados no se reconocen;
 * - la declaración del origen del consentimiento (obligatoria);
 * - la base guardada (`audience_import` + `audience_member`) con sus
 *   columnas extra, que el asistente usa como variables.
 *
 * Todo es del negocio entero (permiso `campaigns.manage` + `contacts.import`):
 * `scoped()` de tenant, no el filtro por asignación.
 */

const PREVIEW_ROWS = 20;
const MAX_FAILURES_STORED = 5_000;

export class AudienceError extends Error {
  code: "invalid" | "not_found";
  constructor(code: AudienceError["code"], message: string) {
    super(message);
    this.name = "AudienceError";
    this.code = code;
  }
}

/** La asignación que llega del cliente: solo campos conocidos e índices dentro de la hoja. */
export function sanitizeMapping(raw: unknown, width: number): ColumnMapping | null {
  if (!raw || typeof raw !== "object") return null;
  const out: ColumnMapping = {};
  const used = new Set<number>();
  for (const col of IMPORT_COLUMNS) {
    const v = (raw as Record<string, unknown>)[col];
    if (v === undefined || v === null || v === "") continue;
    const i = Number(v);
    if (!Number.isInteger(i) || i < 0 || i >= width) {
      throw new AudienceError("invalid", `La columna elegida para "${col}" no existe en el archivo`);
    }
    if (used.has(i)) throw new AudienceError("invalid", "Una misma columna no puede ser dos campos a la vez");
    used.add(i);
    out[col as ImportColumn] = i;
  }
  return out;
}

async function tableAndMapping(fileName: string, bytes: Uint8Array, rawMapping: unknown) {
  const { kind, table } = await readSpreadsheet(fileName, bytes);
  const chosen = sanitizeMapping(rawMapping, table.header.length);
  const mapping = chosen ?? detectColumns(table.header);
  return { kind, table, mapping };
}

function previewSample(table: ImportTable, failures: Map<number, { reason: string; duplicate: boolean }>, warnings: Map<number, string>): PreviewRow[] {
  return table.rows
    .filter((r) => r.cells.some((c) => c.trim() !== ""))
    .slice(0, PREVIEW_ROWS)
    .map((r) => {
      const f = failures.get(r.line);
      return {
        line: r.line,
        cells: r.cells.map((c) => c.slice(0, 120)),
        error: f?.reason ?? null,
        duplicate: f?.duplicate ?? false,
        warning: warnings.get(r.line) ?? null,
      };
    });
}

/**
 * Vista previa SIN escribir nada: columnas reconocidas (o qué falta asignar),
 * primeras filas con las inválidas marcadas y el resumen de lo que pasaría.
 */
export async function previewAudienceFile(input: {
  fileName: string;
  bytes: Uint8Array;
  mapping?: unknown;
}): Promise<AudiencePreviewDto> {
  const { kind, table, mapping } = await tableAndMapping(input.fileName, input.bytes, input.mapping);
  const missing = missingColumns(mapping);
  const base = {
    fileKind: kind,
    header: table.header.map((h) => h.slice(0, 60)),
    mapping,
    missing,
  };
  if (missing.length > 0) {
    return {
      ...base,
      extraColumns: [],
      sample: previewSample(table, new Map(), new Map()),
      summary: null,
    };
  }
  const v = validateTable(table, mapping);
  const failures = new Map(v.failures.map((f) => [f.line, { reason: f.reason, duplicate: f.kind === "duplicate" }]));
  const warnings = new Map(v.warnings.map((w) => [w.line, w.reason]));
  const duplicate = v.failures.filter((f) => f.kind === "duplicate").length;
  return {
    ...base,
    extraColumns: v.extraColumns,
    sample: previewSample(table, failures, warnings),
    summary: {
      totalRows: v.totalRows,
      valid: v.rows.length,
      invalid: v.failures.length - duplicate,
      duplicate,
      empty: v.emptyRows,
      warnings: v.warnings.length,
    },
  };
}

/**
 * Importa la base y la guarda como audiencia. Todo o nada: contactos,
 * etiquetas, la base y sus miembros van en una sola transacción.
 */
export async function importAudienceFile(input: {
  organizationId: string;
  userId: string;
  fileName: string;
  bytes: Uint8Array;
  mapping?: unknown;
  name?: string | null;
  consentDeclaration: string;
}): Promise<{ audience: AudienceDto; summary: ImportSummary }> {
  const declaration = input.consentDeclaration.trim();
  if (declaration.length < 3) {
    throw new AudienceError("invalid", "Indica cómo obtuviste el consentimiento de estos contactos");
  }
  const { kind, table, mapping } = await tableAndMapping(input.fileName, input.bytes, input.mapping);
  const validation = validateTable(table, mapping);
  if (validation.rows.length === 0 && validation.failures.length === 0) {
    throw new ImportError("empty", "El archivo solo tiene la cabecera: no hay contactos que importar");
  }
  const name = (input.name?.trim() || input.fileName).slice(0, 120);
  const audienceId = newId("audienceImport");
  const duplicate = validation.failures.filter((f) => f.kind === "duplicate").length;

  const summary = await importValidated({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    fileName: input.fileName,
    validation,
    consentDeclaration: declaration,
    onMembers: async (tx, members, tag) => {
      const counts: AudienceCounts = {
        totalRows: validation.totalRows,
        created: members.filter((m) => m.created).length,
        updated: members.filter((m) => !m.created).length,
        invalid: validation.failures.length - duplicate,
        duplicate,
        empty: validation.emptyRows,
        members: members.length,
      };
      await tx.insert(schema.audienceImport).values({
        id: audienceId,
        organizationId: input.organizationId,
        name,
        fileName: input.fileName.slice(0, 120),
        fileKind: kind,
        tagId: tag.id,
        consentSource: declaration.slice(0, 200),
        columns: validation.extraColumns,
        counts,
        failures: validation.failures.slice(0, MAX_FAILURES_STORED).map((f) => ({
          line: f.line,
          name: f.name,
          phone: f.phone,
          reason: f.reason,
        })),
        createdBy: input.userId,
      });
      for (let i = 0; i < members.length; i += 500) {
        await tx
          .insert(schema.audienceMember)
          .values(
            members.slice(i, i + 500).map((m) => ({
              organizationId: input.organizationId,
              importId: audienceId,
              contactId: m.contactId,
              fields: m.row.extra,
            }))
          )
          .onConflictDoNothing();
      }
    },
  });
  return { audience: await getAudience(input.organizationId, audienceId), summary };
}

type ImportRow = typeof schema.audienceImport.$inferSelect;

async function consentByImport(organizationId: string, ids: string[]) {
  const out = new Map<string, AudienceDto["consent"]>();
  if (ids.length === 0) return out;
  // scoped-ok: audiencias son de quien ve todo (campaigns.manage).
  const rows = await getDb()
    .select({
      importId: schema.audienceMember.importId,
      consent: schema.contact.waConsent,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.audienceMember)
    .innerJoin(
      schema.contact,
      and(
        eq(schema.contact.organizationId, schema.audienceMember.organizationId),
        eq(schema.contact.id, schema.audienceMember.contactId)
      )
    )
    .where(scoped(schema.audienceMember.organizationId, organizationId, inArray(schema.audienceMember.importId, ids)))
    .groupBy(schema.audienceMember.importId, schema.contact.waConsent);
  for (const r of rows) {
    const c = out.get(r.importId) ?? { optIn: 0, optOut: 0, unknown: 0 };
    if (r.consent === "opt_in") c.optIn += Number(r.n);
    else if (r.consent === "opt_out") c.optOut += Number(r.n);
    else c.unknown += Number(r.n);
    out.set(r.importId, c);
  }
  return out;
}

function serialize(
  row: ImportRow,
  tag: { id: string; name: string } | null,
  consent: AudienceDto["consent"] | undefined
): AudienceDto {
  return {
    id: row.id,
    name: row.name,
    fileName: row.fileName,
    fileKind: row.fileKind,
    consentSource: row.consentSource,
    columns: row.columns,
    counts: row.counts as AudienceCounts,
    consent: consent ?? { optIn: 0, optOut: 0, unknown: 0 },
    tag,
    failuresCount: row.failures.length,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAudiences(organizationId: string): Promise<AudienceDto[]> {
  const rows = await getDb()
    .select({ a: schema.audienceImport, tag: { id: schema.contactTag.id, name: schema.contactTag.name } })
    .from(schema.audienceImport)
    .leftJoin(
      schema.contactTag,
      and(
        eq(schema.contactTag.organizationId, schema.audienceImport.organizationId),
        eq(schema.contactTag.id, schema.audienceImport.tagId)
      )
    )
    .where(scoped(schema.audienceImport.organizationId, organizationId))
    .orderBy(desc(schema.audienceImport.createdAt))
    .limit(200);
  const consent = await consentByImport(
    organizationId,
    rows.map((r) => r.a.id)
  );
  return rows.map((r) => serialize(r.a, r.tag?.id ? r.tag : null, consent.get(r.a.id)));
}

export async function getAudience(organizationId: string, id: string): Promise<AudienceDto> {
  const rows = await getDb()
    .select({ a: schema.audienceImport, tag: { id: schema.contactTag.id, name: schema.contactTag.name } })
    .from(schema.audienceImport)
    .leftJoin(
      schema.contactTag,
      and(
        eq(schema.contactTag.organizationId, schema.audienceImport.organizationId),
        eq(schema.contactTag.id, schema.audienceImport.tagId)
      )
    )
    .where(scoped(schema.audienceImport.organizationId, organizationId, eq(schema.audienceImport.id, id)))
    .limit(1);
  const r = rows[0];
  if (!r) throw new AudienceError("not_found", "Audiencia no encontrada");
  const consent = await consentByImport(organizationId, [id]);
  return serialize(r.a, r.tag?.id ? r.tag : null, consent.get(id));
}

/** Las filas rechazadas, para descargarlas como CSV. */
export async function audienceFailures(organizationId: string, id: string) {
  const rows = await getDb()
    .select({ name: schema.audienceImport.name, failures: schema.audienceImport.failures })
    .from(schema.audienceImport)
    .where(scoped(schema.audienceImport.organizationId, organizationId, eq(schema.audienceImport.id, id)))
    .limit(1);
  const r = rows[0];
  if (!r) throw new AudienceError("not_found", "Audiencia no encontrada");
  return r;
}

/** Borra la base guardada (los contactos y su etiqueta se quedan). */
export async function deleteAudience(organizationId: string, id: string): Promise<void> {
  const deleted = await getDb()
    .delete(schema.audienceImport)
    .where(scoped(schema.audienceImport.organizationId, organizationId, eq(schema.audienceImport.id, id)))
    .returning({ id: schema.audienceImport.id });
  if (!deleted[0]) throw new AudienceError("not_found", "Audiencia no encontrada");
}
