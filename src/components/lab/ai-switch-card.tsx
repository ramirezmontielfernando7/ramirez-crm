"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { PAUSE_LABEL } from "@/lib/agent-pause";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/lab/confirm-dialog";
import { PAUSE_CHANGED_EVENT } from "@/components/lab/agent-pause-bar";
import { call } from "@/components/lab/agents-api";
import { refreshOnboarding } from "@/components/onboarding/use-onboarding";
import { aiSwitchState, type AiSwitchInput } from "@/lib/ai-switch";

/**
 * Auditoría UX 2026-11 (paquete B, maquetas B1/B2) — UN solo interruptor de la
 * IA, arriba de «Mis agentes», que dice la verdad: apagada (con lo que falta
 * para encenderla), contestando, o en pausa. Encender = `agent_profile.enabled`
 * (y quita la pausa); apagar = la pausa general de siempre (042: los chats
 * pasan a una persona, nunca silencio).
 */
export function AiSwitchCard({
  input,
  chats,
  handedOff,
  onChanged,
}: {
  input: AiSwitchInput;
  chats: number;
  handedOff: number;
  onChanged: () => void;
}) {
  const view = aiSwitchState(input);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function turnOn() {
    setBusy(true);
    setError(null);
    if (!input.aiEnabled) {
      const r = await call("/api/agent/profile", { method: "PUT", json: { enabled: true } });
      if (!r.ok) {
        setBusy(false);
        return setError(r.message);
      }
    }
    if (input.orgPaused) {
      const r = await call("/api/agent/pause", { method: "PUT", json: { paused: false } });
      if (!r.ok) {
        setBusy(false);
        return setError(r.message);
      }
    }
    setBusy(false);
    window.dispatchEvent(new Event(PAUSE_CHANGED_EVENT));
    refreshOnboarding();
    onChanged();
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    const r = await call("/api/agent/pause", { method: "PUT", json: { paused: true } });
    setBusy(false);
    setConfirming(false);
    if (!r.ok) return setError(r.message);
    window.dispatchEvent(new Event(PAUSE_CHANGED_EVENT));
    refreshOnboarding();
    onChanged();
  }

  const on = view.kind === "on";
  const paused = view.kind === "paused";

  return (
    <div className="px-4 pt-4 sm:px-6">
      <section
        data-ai-switch={view.kind}
        data-testid={paused ? "agents-paused-banner" : undefined}
        role={paused ? "alert" : undefined}
        aria-label="Interruptor de la IA"
        className={cn(
          "flex flex-wrap items-start gap-x-4 gap-y-3 rounded-xl border px-5 py-4",
          on
            ? "border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-card"
            : paused
              ? "border-destructive/40 bg-destructive/5"
              : "border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-card",
        )}
      >
        <span className="pt-0.5">
          <Switch
            checked={on}
            disabled={busy || (!on && !view.canTurnOn)}
            label={on ? "Apagar la IA" : "Encender la IA"}
            onCheckedChange={(next) => (next ? void turnOn() : setConfirming(true))}
          />
        </span>
        <div className="min-w-0 flex-1 basis-72">
          <p className={cn("text-[15px] font-semibold", paused && "text-destructive")}>{view.title}</p>
          <p className="mt-0.5 text-[13px] text-text-2">
            {on
              ? `Esta semana contestó ${chats.toLocaleString("es-MX")} ${chats === 1 ? "chat" : "chats"} y pasó ${handedOff.toLocaleString("es-MX")} a una persona. Puedes apagarla cuando quieras: los chats pasan a tu equipo.`
              : paused
                ? PAUSE_LABEL.bannerBody
                : view.missing.length > 0
                  ? "Tus clientes no reciben respuesta automática. Para encenderla te falta:"
                  : "Tus clientes no reciben respuesta automática. Ya tienes todo listo para encenderla."}
          </p>
          {view.kind === "off" && (
            <ul className="mt-2 space-y-1 text-[13px]">
              {view.checklist.map((item) => (
                <li key={item.key} className="flex items-center gap-1.5">
                  {item.done ? (
                    <Check className="h-3.5 w-3.5 text-success-text" strokeWidth={2.4} aria-label="Listo" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-destructive" strokeWidth={2.4} aria-label="Falta" />
                  )}
                  <span>{item.label}</span>
                  {!item.done && item.href && (
                    <>
                      <span className="text-text-3">·</span>
                      <Link href={item.href} className="font-medium text-brand-ink hover:underline">
                        {item.cta}
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="mt-2 text-[13px] text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="flex w-full flex-col items-start gap-1 sm:w-auto sm:items-end">
          {on ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(true)} data-testid="agents-pause-all">
              Apagar la IA
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || !view.canTurnOn}
              onClick={() => void turnOn()}
              data-testid={paused ? "agents-resume" : "ai-turn-on"}
            >
              {busy ? "Un momento…" : "Encender la IA"}
            </Button>
          )}
          {!on && !view.canTurnOn && view.hint && <span className="text-[11.5px] text-text-3">{view.hint}</span>}
        </div>
      </section>
      {confirming && (
        <ConfirmDialog
          title="¿Apagar la IA?"
          confirmLabel="Apagar"
          destructive
          busy={busy}
          onConfirm={() => void turnOff()}
          onCancel={() => setConfirming(false)}
        >
          <p>
            Ningún agente responderá. Los chats que iban a atender pasan a tu equipo con su aviso, igual que cuando un agente
            pide ayuda.
          </p>
          <p>No se borra ni cambia nada de su configuración. La enciendes de nuevo aquí mismo cuando quieras.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
