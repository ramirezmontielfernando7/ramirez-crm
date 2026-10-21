"use client";

import { useEffect, useState } from "react";

/**
 * 042 — ¿Están en pausa todos los agentes? Se pregunta al montar la lista y al
 * volver a la pestaña; la lista lo usa para avisarlo UNA vez en su encabezado
 * en lugar de marcar cada fila. Un fallo de red deja el último valor.
 */
export function useAgentsPaused(): boolean {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void fetch("/api/agent/brain-status", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { agentsPaused?: boolean } | null) => {
          if (alive && d) setPaused(d.agentsPaused === true);
        })
        .catch(() => null);
    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return paused;
}
