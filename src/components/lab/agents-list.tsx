"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/lab/confirm-dialog";
import { call, formatDate, NO_NAME_LABEL, STATUS_LABEL, type AgentSummary } from "@/components/lab/agents-api";

type Listing = { agents: AgentSummary[]; maxAgents: number; aiConfigured: boolean };

/**
 * 031 (A2) — Pestaña «Agentes»: una sola columna. El agente general va fijo
 * arriba; cada fila abre el editor (/lab/agents/[id]).
 * El mapa de etapas (qué agente atiende cada etapa) vive en su pestaña: «Asignación por etapa».
 */
export function AgentsList() {
  const router = useRouter();
  const [data, setData] = useState<Listing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toArchive, setToArchive] = useState<AgentSummary | null>(null);

  const load = useCallback(async () => {
    const r = await call<Listing>("/api/lab/agents");
    if (r.ok) {
      setData(r.data);
      setLoadError(null);
    } else setLoadError(r.message);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const r = await call<{ agent: { id: string } }>("/api/lab/agents", { method: "POST", json: { internalName: name } });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    router.push(`/lab/agents/${r.data.agent.id}`);
  }

  async function duplicate(a: AgentSummary) {
    setError(null);
    const r = await call<{ agent: { id: string } }>("/api/lab/agents", {
      method: "POST",
      json: { internalName: `Copia de ${a.internalName}`.slice(0, 60), duplicateOf: a.id },
    });
    if (!r.ok) return setError(r.message);
    router.push(`/lab/agents/${r.data.agent.id}`);
  }

  async function archive() {
    if (!toArchive) return;
    setBusy(true);
    const r = await call(`/api/lab/agents/${toArchive.id}`, { method: "DELETE" });
    setBusy(false);
    setToArchive(null);
    if (!r.ok) setError(r.message);
    else setError(null);
    void load();
  }

  if (loadError) {
    return <p className="p-6 text-sm text-destructive">{loadError}</p>;
  }
  if (!data) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Cargando…</div>;
  }

  const atLimit = data.agents.length >= data.maxAgents;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {data.agents.length} de {data.maxAgents} agentes
          </p>
          {!creating && (
            <Button onClick={() => setCreating(true)} disabled={atLimit} title={atLimit ? "Llegaste al máximo de agentes" : undefined}>
              <Plus className="h-4 w-4" /> Crear agente
            </Button>
          )}
        </div>

        {creating && (
          <form
            className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="min-w-[220px] flex-1 space-y-1">
              <Label htmlFor="new-agent-name">Nombre interno</Label>
              <Input
                id="new-agent-name"
                autoFocus
                maxLength={60}
                placeholder="p. ej. Ventas, Soporte"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Solo lo ve tu equipo. Tus clientes no lo ven.</p>
            </div>
            <Button type="submit" disabled={busy || !newName.trim()}>
              Crear y abrir
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
            >
              Cancelar
            </Button>
          </form>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {data.agents.length === 1 && (
          <p className="text-sm text-muted-foreground">
            Por ahora solo tienes tu agente general. Crea otro para probar ideas sin tocar lo que ya atiende a tus clientes.
          </p>
        )}

        <ul className="divide-y rounded-lg border bg-card">
          {data.agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <Link href={`/lab/agents/${a.id}`} className="min-w-0 flex-1 basis-56 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{a.internalName}</span>
                  {a.isGeneral && <Badge variant="default">General</Badge>}
                  <Badge variant={a.status === "published" ? "success" : a.status === "changes" ? "warning" : "secondary"}>
                    {STATUS_LABEL[a.status]}
                  </Badge>
                </span>
                <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3 shrink-0" strokeWidth={1.7} />
                  {a.displayName ?? NO_NAME_LABEL}
                </span>
              </Link>
              <span className="w-28 text-xs text-muted-foreground">
                {a.lastRun ? (
                  <>
                    Última evaluación: <span className="font-medium text-foreground">{a.lastRun.score ?? "—"}</span>
                    <br />
                    {formatDate(a.lastRun.at)}
                  </>
                ) : (
                  "Sin evaluar"
                )}
              </span>
              <span className="flex flex-wrap gap-1">
                <Link href={`/lab/agents/${a.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                  Editar
                </Link>
                <Link href={`/lab/evaluaciones?agente=${a.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                  Evaluar
                </Link>
                <Button size="sm" variant="ghost" onClick={() => void duplicate(a)} disabled={atLimit} title={atLimit ? "Llegaste al máximo de agentes" : undefined}>
                  Duplicar
                </Button>
                {!a.isGeneral && (
                  <Button size="sm" variant="ghost" onClick={() => setToArchive(a)}>
                    Archivar
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {toArchive && (
        <ConfirmDialog
          title={`¿Archivar «${toArchive.internalName}»?`}
          confirmLabel="Archivar"
          destructive
          busy={busy}
          onConfirm={() => void archive()}
          onCancel={() => setToArchive(null)}
        >
          <p>Deja de aparecer en la lista y ya no se puede evaluar. Si atendía alguna etapa, esa etapa vuelve al agente general (lo verás en «Asignación por etapa»).</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
