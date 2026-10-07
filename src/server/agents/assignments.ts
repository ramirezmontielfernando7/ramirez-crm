import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { getDb, schema, withTenant } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { parseStoredConfig, type AgentConfig } from "./config";
import type { AgentRow } from "./ensure";
import { AgentError } from "./store";

/**
 * 031 (PR B) — ÚNICA puerta de `agent_stage_assignment`: qué agente atiende
 * cada etapa del pipeline. Un agente por etapa (la llave primaria lo
 * garantiza); un agente puede atender varias. Solo se asigna un agente
 * PUBLICADO, no archivado y que no sea el general (un borrador nunca atiende
 * clientes; el general atiende todo lo demás).
 *
 * Archivar un agente NO borra sus asignaciones: el turno las ignora y atiende
 * el general, y la pantalla lo avisa para que alguien decida. Borrar la etapa
 * o el agente (cascade) sí las borra.
 */

/**
 * El nombre con que el EQUIPO reconoce a un agente: el interno, el mismo que
 * encabeza la lista de Agentes. Siempre existe (el de presentación es
 * opcional: un agente sin nombre habla como el negocio).
 */
export function agentLabel(agent: Pick<AgentRow, "internalName">): string {
  return agent.internalName;
}

/**
 * Por qué una asignación no opera: `archived` (el agente se archivó),
 * `unpublished` (sin configuración publicada legible) o `general` (el agente
 * se volvió el general: no debería pasar, «Hacer general» le quita etapas).
 */
export type AssignmentProblem = "archived" | "unpublished" | "general";

export function assignmentProblem(agent: Pick<AgentRow, "archivedAt" | "published" | "isGeneral">): AssignmentProblem | null {
  if (agent.archivedAt) return "archived";
  if (agent.isGeneral) return "general";
  if (!parseStoredConfig(agent.published)) return "unpublished";
  return null;
}

export type StageAssignmentView = {
  stageId: string;
  stageName: string;
  stageKind: "open" | "won" | "lost";
  /** NULL = la atiende el general. */
  agent: {
    id: string;
    internalName: string;
    label: string;
    /** Si no es null, la asignación está guardada pero NO opera (atiende el general). */
    problem: AssignmentProblem | null;
  } | null;
};

export type AssignableAgent = { id: string; internalName: string; label: string };

/** El mapa de etapas (en el orden del pipeline) y los agentes asignables. */
export async function listStageAssignments(
  organizationId: string
): Promise<{ stages: StageAssignmentView[]; assignable: AssignableAgent[] }> {
  const db = getDb();
  const rows = await db
    .select({ stage: schema.pipelineStage, agent: schema.agent })
    .from(schema.pipelineStage)
    .leftJoin(
      schema.agentStageAssignment,
      and(
        eq(schema.agentStageAssignment.organizationId, schema.pipelineStage.organizationId),
        eq(schema.agentStageAssignment.stageId, schema.pipelineStage.id)
      )
    )
    .leftJoin(
      schema.agent,
      and(
        eq(schema.agent.organizationId, schema.agentStageAssignment.organizationId),
        eq(schema.agent.id, schema.agentStageAssignment.agentId)
      )
    )
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const agents = await db
    .select()
    .from(schema.agent)
    .where(scoped(schema.agent.organizationId, organizationId))
    .orderBy(asc(schema.agent.createdAt));

  return {
    stages: rows.map(({ stage, agent }) => ({
      stageId: stage.id,
      stageName: stage.name,
      stageKind: stage.kind,
      agent: agent
        ? { id: agent.id, internalName: agent.internalName, label: agentLabel(agent), problem: assignmentProblem(agent) }
        : null,
    })),
    assignable: agents
      .filter((a) => assignmentProblem(a) === null)
      .map((a) => ({ id: a.id, internalName: a.internalName, label: agentLabel(a) })),
  };
}

/** La etapa ya la atiende otro agente y no se confirmó el reemplazo. */
export class StageTakenError extends Error {
  constructor(readonly current: { agentId: string; internalName: string; label: string }) {
    super(`Esta etapa ya la atiende «${current.label}»`);
    this.name = "StageTakenError";
  }
}

export class StageNotFoundError extends Error {
  constructor() {
    super("Etapa no encontrada");
    this.name = "StageNotFoundError";
  }
}

/**
 * Asigna `agentId` a la etapa. Si la etapa ya tiene OTRO agente y no viene
 * `replace`, lanza `StageTakenError` (la pantalla pide confirmación y
 * reintenta con `replace`). Dos asignaciones a la vez: la fila de la etapa se
 * bloquea, así que una gana y la otra ve a la ganadora (`stage_taken`).
 */
export async function assignStage(
  organizationId: string,
  input: { stageId: string; agentId: string; actorUserId: string; replace?: boolean }
): Promise<void> {
  await withTenant(organizationId, async (tx) => {
    const [stage] = await tx
      .select({ id: schema.pipelineStage.id })
      .from(schema.pipelineStage)
      .where(scoped(schema.pipelineStage.organizationId, organizationId, eq(schema.pipelineStage.id, input.stageId)))
      .limit(1);
    if (!stage) throw new StageNotFoundError();

    const [agent] = await tx
      .select()
      .from(schema.agent)
      .where(scoped(schema.agent.organizationId, organizationId, eq(schema.agent.id, input.agentId)))
      .limit(1)
      .for("share");
    if (!agent || agent.archivedAt) throw new AgentError("not_found", "Agente no encontrado");
    if (agent.isGeneral) {
      throw new AgentError("agent_general", "El agente general ya atiende todas las etapas sin agente propio");
    }
    if (!parseStoredConfig(agent.published)) {
      throw new AgentError("not_published", "Publica este agente antes de asignarlo: un borrador nunca atiende clientes");
    }

    const inserted = await tx
      .insert(schema.agentStageAssignment)
      .values({ organizationId, stageId: input.stageId, agentId: input.agentId, assignedBy: input.actorUserId })
      .onConflictDoNothing()
      .returning({ stageId: schema.agentStageAssignment.stageId });
    if (inserted.length > 0) return;

    const [current] = await tx
      .select({ assignment: schema.agentStageAssignment, agent: schema.agent })
      .from(schema.agentStageAssignment)
      .innerJoin(
        schema.agent,
        and(
          eq(schema.agent.organizationId, schema.agentStageAssignment.organizationId),
          eq(schema.agent.id, schema.agentStageAssignment.agentId)
        )
      )
      .where(
        scoped(
          schema.agentStageAssignment.organizationId,
          organizationId,
          eq(schema.agentStageAssignment.stageId, input.stageId)
        )
      )
      .limit(1)
      .for("update", { of: schema.agentStageAssignment });
    if (current && current.agent.id === input.agentId) return;
    // Una asignación que ya no opera (agente archivado) se reemplaza sin preguntar.
    if (current && !input.replace && assignmentProblem(current.agent) === null) {
      throw new StageTakenError({
        agentId: current.agent.id,
        internalName: current.agent.internalName,
        label: agentLabel(current.agent),
      });
    }
    await tx
      .update(schema.agentStageAssignment)
      .set({ agentId: input.agentId, assignedBy: input.actorUserId, assignedAt: new Date() })
      .where(
        scoped(
          schema.agentStageAssignment.organizationId,
          organizationId,
          eq(schema.agentStageAssignment.stageId, input.stageId)
        )
      );
  });
}

/** La etapa vuelve al general. Idempotente. */
export async function unassignStage(organizationId: string, stageId: string): Promise<void> {
  await getDb()
    .delete(schema.agentStageAssignment)
    .where(scoped(schema.agentStageAssignment.organizationId, organizationId, eq(schema.agentStageAssignment.stageId, stageId)));
}

/** «Hacer general»: el general no tiene etapas (en la transacción de quien llama). */
export async function removeAgentStages(tx: Db, organizationId: string, agentId: string): Promise<void> {
  await tx
    .delete(schema.agentStageAssignment)
    .where(scoped(schema.agentStageAssignment.organizationId, organizationId, eq(schema.agentStageAssignment.agentId, agentId)));
}

export type StageAgent =
  | { ok: true; agent: AgentRow; config: AgentConfig; stageName: string }
  | { ok: false; reason: "no_assignment" }
  | { ok: false; reason: AssignmentProblem; agentId: string; stageName: string };

/**
 * El agente asignado a la etapa ACTUAL del lead de un contacto. Una consulta
 * (lead → asignación → agente). Solo lee: quien llama decide si aplica
 * (módulo Laboratorio, conversación real).
 */
export async function stageAgentForContact(organizationId: string, contactId: string): Promise<StageAgent> {
  const [row] = await getDb()
    .select({ agent: schema.agent, stageName: schema.pipelineStage.name })
    .from(schema.lead)
    .innerJoin(
      schema.agentStageAssignment,
      and(
        eq(schema.agentStageAssignment.organizationId, schema.lead.organizationId),
        eq(schema.agentStageAssignment.stageId, schema.lead.stageId)
      )
    )
    .innerJoin(
      schema.pipelineStage,
      and(eq(schema.pipelineStage.organizationId, schema.lead.organizationId), eq(schema.pipelineStage.id, schema.lead.stageId))
    )
    .innerJoin(
      schema.agent,
      and(eq(schema.agent.organizationId, schema.agentStageAssignment.organizationId), eq(schema.agent.id, schema.agentStageAssignment.agentId))
    )
    .where(scoped(schema.lead.organizationId, organizationId, eq(schema.lead.contactId, contactId)))
    .limit(1);
  if (!row) return { ok: false, reason: "no_assignment" };
  const problem = assignmentProblem(row.agent);
  if (problem) return { ok: false, reason: problem, agentId: row.agent.id, stageName: row.stageName };
  return { ok: true, agent: row.agent, config: parseStoredConfig(row.agent.published)!, stageName: row.stageName };
}
