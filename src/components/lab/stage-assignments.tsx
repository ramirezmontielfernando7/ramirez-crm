"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/lab/confirm-dialog";
import { call } from "@/components/lab/agents-api";
import type { AssignableAgent, StageAssignmentView } from "@/server/agents/assignments";

type Listing = { stages: StageAssignmentView[]; assignable: AssignableAgent[] };

/** Valor del selector que significa «sin agente propio: el general». */
const GENERAL = "";

const PROBLEM_TEXT: Record<NonNullable<NonNullable<StageAssignmentView["agent"]>["problem"]>, string> = {
  archived: "fue archivado",
  unpublished: "no tiene una versión publicada",
  general: "ahora es el agente general",
};

type Pending = { stage: StageAssignmentView; agent: AssignableAgent; currentLabel: string };

/**
 * 031 (PR B) — Pestaña «Asignación por etapa»: cada etapa del pipeline con
 * el agente que la atiende. Sin agente propio, la atiende el general. Solo se
 * asignan agentes publicados; si la etapa ya tiene otro, se pide confirmación
 * (el servidor responde `stage_taken`).
 */
export function StageAssignments() {
  const [data, setData] = useState<Listing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyStage, setBusyStage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback(async () => {
    const r = await call<Listing>("/api/lab/assignments");
    if (r.ok) {
      setData(r.data);
      setLoadError(null);
    } else setLoadError(r.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function assign(stage: StageAssignmentView, agent: AssignableAgent, replace: boolean) {
    setBusyStage(stage.stageId);
    setError(null);
    const res = await fetch(`/api/lab/assignments/${encodeURIComponent(stage.stageId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: agent.id, replace }),
    }).catch(() => null);
    setBusyStage(null);
    if (!res) return setError("No hay conexión. Revisa tu internet e inténtalo de nuevo.");
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string; current?: { label: string } };
      } | null;
      if (body?.error?.code === "stage_taken" && body.error.current) {
        setPending({ stage, agent, currentLabel: body.error.current.label });
        return;
      }
      setError(body?.error?.message ?? "No se pudo asignar. Inténtalo de nuevo.");
      return void load();
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "No se pudo asignar. Inténtalo de nuevo.");
    }
    void load();
  }

  async function unassign(stage: StageAssignmentView) {
    setBusyStage(stage.stageId);
    setError(null);
    const r = await call(`/api/lab/assignments/${encodeURIComponent(stage.stageId)}`, { method: "DELETE" });
    setBusyStage(null);
    if (!r.ok) setError(r.message);
    void load();
  }

  function onPick(stage: StageAssignmentView, value: string) {
    if (value === GENERAL) return void unassign(stage);
    const agent = data?.assignable.find((a) => a.id === value);
    if (agent) void assign(stage, agent, false);
  }

  if (loadError) return <p className="p-6 text-sm text-destructive">{loadError}</p>;
  if (!data) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Cargando…</div>;
  }

  const field = "h-9 w-full min-w-[12rem] rounded-md border border-border-strong bg-background px-2.5 text-sm sm:w-56";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">
          Elige qué agente atiende a los clientes de cada etapa del pipeline. Las etapas sin agente propio las atiende el
          agente general. Solo puedes asignar agentes publicados.
        </p>

        {data.assignable.length === 0 && (
          <p className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">
            Todavía no tienes agentes para asignar. Crea un agente, publícalo y vuelve aquí.{" "}
            <Link href="/lab" className="font-medium text-foreground underline underline-offset-2">
              Ir a Agentes
            </Link>
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {data.stages.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tu pipeline no tiene etapas todavía.</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card" aria-label="Etapas del pipeline">
            {data.stages.map((s) => {
              const working = s.agent && !s.agent.problem ? s.agent : null;
              const selectId = `stage-agent-${s.stageId}`;
              return (
                <li key={s.stageId} className="space-y-2 px-4 py-3" data-stage={s.stageName}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1 basis-48">
                      <label htmlFor={selectId} className="block truncate font-medium">
                        {s.stageName}
                      </label>
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                        <Bot className="h-3 w-3 shrink-0" strokeWidth={1.7} />
                        {working ? (
                          <>
                            Atiende <span className="font-medium text-foreground">{working.label}</span>
                          </>
                        ) : (
                          <>
                            Atiende el <Badge variant="default">General</Badge>
                          </>
                        )}
                      </span>
                    </div>
                    <select
                      id={selectId}
                      className={field}
                      value={working?.id ?? GENERAL}
                      disabled={busyStage === s.stageId}
                      onChange={(e) => onPick(s, e.target.value)}
                    >
                      <option value={GENERAL}>Agente general</option>
                      {data.assignable.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {s.agent?.problem && (
                    <div className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-2.5 text-xs leading-relaxed text-warning-text">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                      <p>
                        «{s.agent.label}» {PROBLEM_TEXT[s.agent.problem]}: esta etapa la atiende ahora el agente general.
                        Elige otro agente o{" "}
                        <button
                          type="button"
                          className="font-medium underline underline-offset-2"
                          onClick={() => void unassign(s)}
                          disabled={busyStage === s.stageId}
                        >
                          déjala con el general
                        </button>
                        .
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          Cuando un cliente cambia de etapa, el siguiente mensaje lo contesta el agente de su nueva etapa y queda anotado en
          la línea de tiempo del chat.{" "}
          <Link href="/lab" className="font-medium text-foreground underline underline-offset-2">
            Ver agentes
          </Link>
        </p>
      </div>

      {pending && (
        <ConfirmDialog
          title={`¿Cambiar el agente de «${pending.stage.stageName}»?`}
          confirmLabel="Sí, cambiar"
          busy={busyStage === pending.stage.stageId}
          onConfirm={() => {
            const p = pending;
            setPending(null);
            void assign(p.stage, p.agent, true);
          }}
          onCancel={() => {
            setPending(null);
            void load();
          }}
        >
          <p>
            Esta etapa ya la atiende «{pending.currentLabel}». Si continúas, la atenderá «{pending.agent.label}».
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
