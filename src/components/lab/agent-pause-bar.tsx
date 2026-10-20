"use client";

import { useCallback, useEffect, useState } from "react";
import { PauseCircle } from "lucide-react";
import { PAUSE_LABEL } from "@/lib/agent-pause";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { call } from "@/components/lab/agents-api";
import { ConfirmDialog } from "@/components/lab/confirm-dialog";

/** Avisa a la lista de agentes (y a quien escuche) que la pausa general cambió. */
export const PAUSE_CHANGED_EVENT = "vocero:agents-pause-changed";

type PauseState = { paused: boolean; pausedAt: string | null };

/**
 * 042 — El interruptor GENERAL de los agentes de IA y su aviso. Siempre
 * visible arriba del Estudio de IA: encendido es una barra discreta; en pausa
 * es un aviso rojo que no se puede pasar por alto (es el freno de emergencia
 * durante campañas masivas). Pausar pide confirmación; reanudar, no.
 */
export function AgentPauseBar() {
  const [state, setState] = useState<PauseState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await call<PauseState>("/api/agent/pause");
    if (r.ok) setState(r.data);
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener(PAUSE_CHANGED_EVENT, load);
    return () => window.removeEventListener(PAUSE_CHANGED_EVENT, load);
  }, [load]);

  async function set(paused: boolean) {
    setBusy(true);
    setError(null);
    const r = await call<PauseState>("/api/agent/pause", { method: "PUT", json: { paused } });
    setBusy(false);
    setConfirming(false);
    if (!r.ok) return setError(r.message);
    setState(r.data);
    window.dispatchEvent(new Event(PAUSE_CHANGED_EVENT));
  }

  if (!state) return null;

  return (
    <div className="px-4 pt-3 sm:px-6">
      {state.paused ? (
        <div
          role="alert"
          data-testid="agents-paused-banner"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3"
        >
          <PauseCircle className="h-5 w-5 shrink-0 text-destructive" strokeWidth={1.8} />
          <div className="min-w-0 flex-1 basis-64">
            <p className="text-sm font-semibold text-destructive">{PAUSE_LABEL.banner}</p>
            <p className="text-xs text-muted-foreground">{PAUSE_LABEL.bannerBody}</p>
          </div>
          <Button size="sm" onClick={() => void set(false)} disabled={busy} data-testid="agents-resume">
            {busy ? "Un momento…" : "Reanudar agentes"}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2">
          <p className="text-sm text-muted-foreground">
            Agentes de IA: <span className="font-medium text-foreground">activos</span>
          </p>
          <Switch
            checked
            disabled={busy}
            label="Agentes de IA activos (apagar todos)"
            onCheckedChange={() => setConfirming(true)}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title="¿Pausar todos los agentes de IA?"
          confirmLabel="Pausar todos"
          destructive
          busy={busy}
          onConfirm={() => void set(true)}
          onCancel={() => setConfirming(false)}
        >
          <p>
            Ningún agente responderá. Los chats que iban a atender pasan a atención humana, igual que cuando un agente
            pide ayuda: tu equipo los verá con su aviso.
          </p>
          <p>No se borra ni cambia nada de su configuración. Al reanudar, los agentes vuelven a responder los chats nuevos; los que ya pasaron a una persona se quedan con ella.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
