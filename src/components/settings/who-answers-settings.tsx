"use client";

import { useCallback, useEffect, useState } from "react";
import { Cable } from "lucide-react";
import { BrainStatusCard } from "@/components/agent/brain-status-card";
import { AgentPauseBar } from "@/components/lab/agent-pause-bar";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { externalAnswerLabel, externalAnswering, type BrainStatusDto } from "@/lib/brain-status";

/**
 * Interruptor general de la IA (el perfil del agente general: encendido o
 * apagado) y el estado del cerebro externo. Es lo que hacía /agent además de
 * editar al agente; el agente en sí se edita en Agentes IA.
 */
export function WhoAnswersSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [brain, setBrain] = useState<BrainStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, b] = await Promise.all([
      fetch("/api/agent/profile").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/agent/brain-status").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (!p) {
      setError("No pudimos cargar el estado de la IA. Revisa tu conexión e intenta de nuevo.");
      return;
    }
    setError(null);
    setEnabled(p.profile.enabled);
    setAiConfigured(p.aiConfigured);
    setBrain(b);
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  async function toggle(next: boolean) {
    setEnabled(next);
    const res = await fetch("/api/agent/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null);
    if (!res?.ok) setError("No se guardó el cambio. Intenta de nuevo.");
    void load();
  }

  if (error && enabled === null) {
    return (
      <div role="alert" className="rounded-lg border bg-card p-6 text-center text-sm">
        <p className="font-medium">{error}</p>
        <button type="button" className="mt-3 font-medium underline" onClick={() => void load()}>
          Reintentar
        </button>
      </div>
    );
  }
  if (enabled === null) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
          {error}
        </p>
      )}
      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-4 sm:p-5">
          <div>
            <p className="font-medium">IA de tu negocio</p>
            <p className="text-sm text-muted-foreground">
              {enabled ? "Encendida: contesta a tus clientes." : "Apagada: nadie contesta en automático."}
              {!aiConfigured && " El servicio de IA de tu cuenta aún no está activo: escríbenos y lo activamos."}
            </p>
          </div>
          <Switch checked={enabled} disabled={!aiConfigured} label="Agente encendido" onCheckedChange={(v) => void toggle(v)} />
        </CardContent>
      </Card>
      <AgentPauseBar />
      {brain && <BrainStatusCard status={brain} />}
      {brain && !aiConfigured && externalAnswering(brain) && (
        <div className="rounded-lg border border-brand-soft bg-brand-tint p-5 text-center">
          <Cable className="mx-auto mb-2 h-8 w-8 text-primary" strokeWidth={1.7} />
          <p className="font-medium">{externalAnswerLabel(brain)}</p>
        </div>
      )}
    </div>
  );
}
