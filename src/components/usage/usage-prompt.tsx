"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useViewer } from "@/components/viewer-context";
import { fetchJson } from "@/lib/fetch-json";
import { closeUsageDialog, getUsageDialogState, openUsageDialog } from "@/lib/usage-dialog";
import { dayMonth, markShown, shouldShowPrompt, type PromptKind, type PromptMemory } from "@/lib/upgrade-prompts";
import type { PaceResult } from "@/server/usage/pace";
import { cn } from "@/lib/utils";

/**
 * Ventana de aviso del Propietario: «Vas muy rápido con la IA» (80 % o a ese
 * ritmo no llega al mes) y «Llegaste al límite». Sale al abrir la app —no a
 * medio escribir—, una vez por semana (aviso) o por día (límite); «Recordármelo
 * después» la calla 3 días. La memoria vive en el navegador (solo comodidad).
 * Sin cobro: «Mejorar plan» abre «Mejora tu plan».
 */
const KEY = "dashfort-usage-prompt";

function readMemory(): PromptMemory {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as PromptMemory;
  } catch {
    return {};
  }
}
function writeMemory(m: PromptMemory) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* sin almacenamiento: se avisará de nuevo la próxima vez */
  }
}

const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable);
};

export function UsagePrompt() {
  const viewer = useViewer();
  const allowed = viewer.can("usage.read");
  const [data, setData] = useState<PaceResult | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let vivo = true;
    const t = setTimeout(async () => {
      const r = await fetchJson<PaceResult>("/api/usage/pace");
      if (!vivo || !r.ok || !r.data.kind) return;
      if (getUsageDialogState().open || typing()) return;
      if (!shouldShowPrompt(r.data.kind, readMemory(), new Date())) return;
      writeMemory(markShown(r.data.kind, readMemory(), new Date()));
      setData(r.data);
    }, 2500);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [allowed]);

  useEffect(() => {
    if (!data) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setData(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [data]);

  if (!allowed || !data?.kind) return null;
  const kind: PromptKind = data.kind;
  const p = data.pace;
  const limit = kind === "limit";
  const reset = p ? dayMonth(p.resetDate) : "que se renueve";
  const close = () => setData(null);
  const snooze = () => {
    writeMemory(markShown(kind, readMemory(), new Date(), true));
    close();
  };

  return (
    <div className="usage-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && close()} data-testid="usage-prompt-overlay">
      <div role="dialog" aria-modal="true" aria-labelledby="usage-prompt-title" data-testid={`usage-prompt-${kind}`} className="usage-modal relative w-full max-w-[560px] outline-none">
        <div className="flex items-center gap-3 px-6 pt-5">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", limit ? "bg-danger-tint text-danger-text" : "bg-warning-tint text-warning-text")}>
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <h2 id="usage-prompt-title" className="text-lg font-semibold tracking-tight">
            {limit ? "Llegaste al límite de IA de este mes" : "Vas muy rápido con la IA"}
          </h2>
          <button type="button" onClick={close} aria-label="Cerrar" className="ml-auto rounded-md p-1.5 text-text-3 hover:bg-accent hover:text-foreground">
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>
        <div className="px-6 pb-6 pt-3">
          {limit ? (
            <p className="text-[15px] leading-relaxed">
              Los agentes ya no responden solos. <b>Los chats nuevos pasan a tu equipo</b> y todo vuelve a funcionar el {reset}. Nadie se queda sin respuesta.
            </p>
          ) : (
            <p className="text-[15px] leading-relaxed">
              Ya usaste <b>{p?.percent ?? 80} %</b> de tu IA de este mes.{" "}
              {p?.hitDate ? (
                <>
                  A este ritmo <b>llegarás a tu límite el {dayMonth(p.hitDate)}</b>, antes de que se renueve el {reset}.
                </>
              ) : (
                <>Se renueva el {reset}.</>
              )}
            </p>
          )}
          {!limit && <p className="mt-2 text-sm text-text-2">Si llegas al tope, los agentes pasan los chats a tu equipo hasta que se renueve.</p>}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {data.nextPlan && (
              <button
                type="button"
                data-testid="usage-prompt-upgrade"
                className="usage-btn-dark rounded-lg px-4 py-2 text-sm font-medium"
                onClick={() => {
                  close();
                  openUsageDialog("planes");
                }}
              >
                Mejorar plan
              </button>
            )}
            <button
              type="button"
              className="rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
              onClick={() => {
                close();
                closeUsageDialog();
                openUsageDialog("uso");
              }}
            >
              Ver mi uso
            </button>
            <button type="button" data-testid="usage-prompt-later" className="ml-auto rounded-lg px-3 py-2 text-sm font-medium text-brand-text hover:underline" onClick={limit ? close : snooze}>
              {limit ? "Entendido" : "Recordármelo después"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
