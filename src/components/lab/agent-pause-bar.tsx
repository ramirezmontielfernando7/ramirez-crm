"use client";

import { useCallback, useEffect, useState } from "react";
import { PauseCircle } from "lucide-react";
import { PAUSE_LABEL } from "@/lib/agent-pause";
import { Button } from "@/components/ui/button";
import { call } from "@/components/lab/agents-api";

/** Avisa a la lista de agentes (y a quien escuche) que la pausa general cambió. */
export const PAUSE_CHANGED_EVENT = "vocero:agents-pause-changed";

type PauseState = { paused: boolean; pausedAt: string | null };

/** Lee la pausa general y la mueve (compartido por el aviso y el botón). */
function useOrgPause() {
  const [state, setState] = useState<PauseState | null>(null);
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

  async function set(paused: boolean): Promise<boolean> {
    setBusy(true);
    setError(null);
    const r = await call<PauseState>("/api/agent/pause", { method: "PUT", json: { paused } });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return false;
    }
    setState(r.data);
    window.dispatchEvent(new Event(PAUSE_CHANGED_EVENT));
    return true;
  }

  return { state, busy, error, set };
}

/**
 * 042 — El aviso de la pausa GENERAL de los agentes de IA. Solo aparece en
 * pausa: un aviso rojo que no se puede pasar por alto (es el freno de
 * emergencia durante campañas masivas). Ronda 3: encendido no se pinta nada;
 * pausar es el botón «Pausar toda la IA» de «Mis agentes» (`PauseAllButton`).
 */
export function AgentPauseBar() {
  const { state, busy, error, set } = useOrgPause();
  if (!state?.paused) return null;

  return (
    <div className="px-4 pt-3 sm:px-6">
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
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

