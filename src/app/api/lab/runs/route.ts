import { desc } from "drizzle-orm";
import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isAiConfigured } from "@/lib/env";
import { RunConflictError, startRun } from "@/server/lab/runner";
import { moduleOff } from "@/server/modules";
import { withAgentErrors } from "@/server/agents/http";

export const dynamic = "force-dynamic";

/** Historial de corridas con delta de score vs la anterior (FR-033). */
export const GET = withAuth(async (session) => {
  const off = await moduleOff(session.organizationId, "lab");
  if (off) return off;
  const db = getDb();
  const runs = await db
    .select()
    .from(schema.agentTestRun)
    .where(scoped(schema.agentTestRun.organizationId, session.organizationId))
    .orderBy(desc(schema.agentTestRun.startedAt))
    .limit(50);

  const withDelta = runs.map((run, i) => {
    const prev = runs
      .slice(i + 1)
      .find((r) => r.status === "done" && r.score !== null);
    return {
      id: run.id,
      status: run.status,
      score: run.score,
      error: run.error,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      // 031: qué agente y qué versión se evaluó (null en corridas anteriores).
      agentId: run.agentId,
      agentName: snapshotName(run.agentSnapshot),
      source: snapshotSource(run.agentSnapshot),
      delta:
        run.status === "done" && run.score !== null && prev?.score != null
          ? run.score - prev.score
          : null,
    };
  });
  return Response.json({ runs: withDelta, aiConfigured: isAiConfigured() });
}, { permission: "agent.manage" });

/** 031 — `{ agentId?, source? }` (cuerpo opcional: sin él, el general publicado). */
const startSchema = z
  .object({
    agentId: z.string().min(1).optional(),
    source: z.enum(["draft", "published"]).optional(),
  })
  .strict();

export const POST = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "lab");
  if (off) return off;
  if (!isAiConfigured()) {
    return apiError(
      409,
      "ai_not_configured",
      "Configura tu proveedor de IA para correr el Laboratorio"
    );
  }
  const raw = (await req.text().catch(() => "")).trim();
  let json: unknown = {};
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      return apiError(422, "invalid_body", "El body debe ser JSON válido");
    }
  }
  const body = startSchema.safeParse(json);
  if (!body.success) return apiError(422, "invalid_body", body.error.issues.map((i) => i.message).join("; "));
  return withAgentErrors(async () => {
    try {
      const runId = await startRun(session.organizationId, body.data);
      return Response.json({ runId }, { status: 202 });
    } catch (err) {
      if (err instanceof RunConflictError) {
        return apiError(
          409,
          "run_in_progress",
          "Ya hay una corrida en curso; espera a que termine"
        );
      }
      throw err;
    }
  });
}, { permission: "agent.manage" });

function snapshotName(snapshot: unknown): string | null {
  const s = snapshot as { internalName?: unknown } | null;
  return typeof s?.internalName === "string" ? s.internalName : null;
}

function snapshotSource(snapshot: unknown): "draft" | "published" | null {
  const s = snapshot as { source?: unknown } | null;
  return s?.source === "draft" || s?.source === "published" ? s.source : null;
}
