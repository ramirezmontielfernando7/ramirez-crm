import { and, asc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * 031 — ÚNICA puerta de escritura de `kb_entry` (el conocimiento que lee el
 * agente de IA). Las rutas `/api/kb`, la sugerencia aplicada del Laboratorio
 * y el seed de la demo pasan por aquí; el guardarraíl
 * `tests/unit/kb-gate.test.ts` lo vigila.
 *
 * `agentId`: `null` = conocimiento COMPARTIDO (todo lo que existía antes de
 * 031); un id = solo de ese agente. El agente que atiende lee el compartido
 * (si su config lo pide; el general siempre) más el suyo.
 */

export type KbEntry = typeof schema.kbEntry.$inferSelect;

/** Lo mínimo que hace falta para el prompt y para el snapshot de una corrida. */
export type KbItem = Pick<KbEntry, "id" | "kind" | "question" | "answer" | "content">;

export class KbError extends Error {
  constructor(readonly code: "agent_not_found" | "not_found") {
    super(code);
    this.name = "KbError";
  }
}

export type KbInput =
  | { kind: "qa"; question: string; answer: string }
  | { kind: "block"; content: string };

/** El agente existe en ESTA organización y no está archivado. */
async function assertAgent(organizationId: string, agentId: string, db: Db): Promise<void> {
  const [row] = await db
    .select({ id: schema.agent.id })
    .from(schema.agent)
    .where(scoped(schema.agent.organizationId, organizationId, and(eq(schema.agent.id, agentId), isNull(schema.agent.archivedAt))))
    .limit(1);
  if (!row) throw new KbError("agent_not_found");
}

export async function createKbEntry(
  organizationId: string,
  input: KbInput & { agentId?: string | null },
  db: Db = getDb()
): Promise<KbEntry> {
  const agentId = input.agentId ?? null;
  if (agentId) await assertAgent(organizationId, agentId, db);
  const [row] = await db
    .insert(schema.kbEntry)
    .values({
      id: newId("kbEntry"),
      organizationId,
      agentId,
      kind: input.kind,
      question: input.kind === "qa" ? input.question : null,
      answer: input.kind === "qa" ? input.answer : null,
      content: input.kind === "block" ? input.content : null,
    })
    .returning();
  return row!;
}

/** Copia el conocimiento propio de un agente a otro (Duplicar). */
export async function copyAgentKb(organizationId: string, fromAgentId: string, toAgentId: string, db: Db): Promise<void> {
  const rows = await db
    .select()
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId, eq(schema.kbEntry.agentId, fromAgentId)))
    .orderBy(asc(schema.kbEntry.createdAt));
  if (rows.length === 0) return;
  await db.insert(schema.kbEntry).values(
    rows.map((r) => ({
      id: newId("kbEntry"),
      organizationId,
      agentId: toAgentId,
      kind: r.kind,
      question: r.question,
      answer: r.answer,
      content: r.content,
    }))
  );
}

/**
 * Filtro por dueño. `undefined` = sin filtro de dueño (no se usa desde
 * rutas); `null` = solo el compartido; un id = solo ese agente.
 */
function owner(agentId: string | null | undefined): SQL | undefined {
  if (agentId === undefined) return undefined;
  return agentId === null ? isNull(schema.kbEntry.agentId) : eq(schema.kbEntry.agentId, agentId);
}

export async function updateKbEntry(
  organizationId: string,
  id: string,
  patch: { question?: string; answer?: string; content?: string },
  agentId?: string | null
): Promise<KbEntry | null> {
  const [row] = await getDb()
    .update(schema.kbEntry)
    .set({ ...patch, updatedAt: new Date() })
    .where(scoped(schema.kbEntry.organizationId, organizationId, and(eq(schema.kbEntry.id, id), owner(agentId))))
    .returning();
  return row ?? null;
}

export async function deleteKbEntry(organizationId: string, id: string, agentId?: string | null): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId, and(eq(schema.kbEntry.id, id), owner(agentId))))
    .returning({ id: schema.kbEntry.id });
  return rows.length > 0;
}

/** Las entradas de UN dueño (compartido = `null`), en orden de alta. */
export async function listKbEntries(organizationId: string, agentId: string | null): Promise<KbEntry[]> {
  return getDb()
    .select()
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId, owner(agentId)))
    .orderBy(asc(schema.kbEntry.createdAt));
}

/**
 * El conocimiento que LEE un agente: el compartido (si `useSharedKb`) más el
 * propio, en orden de alta. Con `agentId = null` (sin agente) solo el
 * compartido.
 */
export async function kbForAgent(
  organizationId: string,
  agentId: string | null,
  useSharedKb: boolean
): Promise<KbEntry[]> {
  const parts: SQL[] = [];
  if (useSharedKb || !agentId) parts.push(isNull(schema.kbEntry.agentId));
  if (agentId) parts.push(eq(schema.kbEntry.agentId, agentId));
  return getDb()
    .select()
    .from(schema.kbEntry)
    .where(scoped(schema.kbEntry.organizationId, organizationId, or(...parts)))
    .orderBy(asc(schema.kbEntry.createdAt));
}

export function toKbItems(entries: KbEntry[]): KbItem[] {
  return entries.map((e) => ({ id: e.id, kind: e.kind, question: e.question, answer: e.answer, content: e.content }));
}

/**
 * Filtro SQL del conocimiento del agente GENERAL (compartido + el suyo), en
 * la MISMA sentencia (subconsulta): lo usa `/api/bot/profile`, cuyo contrato
 * es el del general y no debe ver el conocimiento privado de otros agentes.
 */
export function generalKbCondition(organizationId: string): SQL {
  return sql`(${schema.kbEntry.agentId} is null or ${schema.kbEntry.agentId} in (select ${schema.agent.id} from ${schema.agent} where ${schema.agent.organizationId} = ${organizationId} and ${schema.agent.isGeneral} and ${schema.agent.archivedAt} is null))`;
}
