"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { useViewer } from "@/components/viewer-context";

type Alert = { metric: string; threshold: 80 | 100; text: string };

const REFRESH_MS = 5 * 60_000;

/**
 * 036 (PR 3a) — Aviso de consumo para el Propietario (`usage.read`): su
 * organización va en el 80 % o llegó al 100 % de un tope (IA, embeddings,
 * almacenamiento, personas, módulos). «Entendido» lo marca como visto en el
 * servidor; vuelve solo si cruza otro umbral o empieza otro mes.
 */
export function UsageAlertBanner() {
  const viewer = useViewer();
  const allowed = viewer.can("usage.read");
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const load = useCallback(async () => {
    const res = await fetchJson<{ alerts: Alert[] }>("/api/usage/alerts");
    if (res.ok) setAlerts(res.data.alerts);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [allowed, load]);

  if (!allowed || alerts.length === 0) return null;
  const lleno = alerts.some((a) => a.threshold >= 100);
  return (
    <div
      role="alert"
      data-testid="usage-alert-banner"
      className={cn(
        "flex shrink-0 items-start gap-2 border-b px-4 py-2 text-sm",
        lleno ? "border-danger-soft bg-danger-tint text-danger-text" : "border-warning-soft bg-warning-tint text-warning-text"
      )}
    >
      <Gauge className="mt-0.5 h-4 w-4 shrink-0" />
      <ul className="min-w-0 flex-1 space-y-0.5">
        {alerts.map((a) => (
          <li key={a.metric} data-testid={`usage-alert-${a.metric}`}>
            {a.text}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="shrink-0 rounded px-2 py-0.5 text-xs font-medium underline-offset-2 hover:underline"
        data-testid="usage-alert-seen"
        onClick={() => {
          setAlerts([]);
          void fetchJson("/api/usage/alerts", { method: "POST" });
        }}
      >
        Entendido
      </button>
    </div>
  );
}
