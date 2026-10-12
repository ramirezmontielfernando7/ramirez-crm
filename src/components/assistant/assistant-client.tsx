"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, BotMessageSquare } from "lucide-react";
import { NavRevealButton } from "@/components/nav-mode";
import { Button } from "@/components/ui/button";
import { UsageMeter } from "@/components/usage/usage-meter";
import {
  ASSISTANT_COST_NOTICE,
  ASSISTANT_NOTICE_TITLE,
  ASSISTANT_READ_ONLY_NOTICE,
  resetLabel,
  type AssistantStatus,
} from "@/lib/assistant";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { countMeter, formatTokens } from "@/lib/usage";
import { gaugeMeter } from "@/lib/usage-visibility";
import { cn } from "@/lib/utils";

/**
 * 038 (PR 1) — Pantalla del asistente interno: el aviso FIJO de que cada
 * pregunta consume bastante crédito de IA, la confirmación antes del primer
 * uso (una vez por persona) y el estado de su crédito (disponible, agotado…)
 * con un mensaje claro. Las preguntas llegan con el motor (PR 2).
 */
export function AssistantClient() {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivo = true;
    void fetchJson<{ status: AssistantStatus }>("/api/assistant/status").then((r) => {
      if (!vivo) return;
      if (r.ok) setStatus(r.data.status);
      else setError(r.error);
    });
    return () => {
      vivo = false;
    };
  }, []);

  async function accept() {
    setBusy(true);
    const r = await fetchJson<{ noticeAcceptedAt: string }>("/api/assistant/notice", jsonInit("POST", {}));
    setBusy(false);
    if (!r.ok) {
      setError(`No se guardó la confirmación: ${r.error}`);
      return;
    }
    setStatus((s) => (s ? { ...s, noticeAcceptedAt: r.data.noticeAcceptedAt } : s));
  }

  const meter = status?.gauge
    ? status.gauge.used !== undefined
      ? countMeter(status.gauge.used, status.gauge.limit ?? null, "tokens", formatTokens)
      : gaugeMeter(status.gauge)
    : null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
        <NavRevealButton />
        <h2 className="text-[17px] font-bold tracking-tight">Asistente interno</h2>
      </header>

      <div
        role="note"
        data-testid="assistant-cost-banner"
        className="flex shrink-0 items-start gap-2 border-b border-warning-soft bg-warning-tint px-4 py-2 text-sm text-warning-text sm:px-6"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0">{ASSISTANT_COST_NOTICE}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {!status ? (
            <p className={cn("text-sm", error ? "text-destructive" : "text-text-2")}>{error ?? "Cargando el asistente…"}</p>
          ) : (
            <>
              <section className="rounded-md border bg-card p-4" data-testid="assistant-status" data-state={status.state}>
                <div className="flex items-center gap-2">
                  <BotMessageSquare className="h-4 w-4 shrink-0 text-text-2" aria-hidden />
                  <h3 className="text-sm font-semibold">Crédito del asistente</h3>
                </div>
                {meter && (
                  <div className="mt-3">
                    <UsageMeter meter={meter} label="Crédito del asistente" testId="assistant-credit" showLabel="never" />
                  </div>
                )}
                <p
                  className={cn("mt-3 text-sm", status.canAsk ? "text-text-2" : "text-danger-text")}
                  data-testid="assistant-status-message"
                  role={status.canAsk ? undefined : "alert"}
                >
                  {status.message}
                </p>
                {status.canAsk && (
                  <p className="mt-1 text-xs text-text-3">El crédito se renueva el {resetLabel(status.resetsOn)}.</p>
                )}
              </section>

              <section className="rounded-md border bg-card p-4 text-sm text-text-2" data-testid="assistant-coming">
                <p>{ASSISTANT_READ_ONLY_NOTICE}</p>
                <p className="mt-2 text-text-3">Muy pronto podrás hacerle preguntas aquí sobre el uso y el plan de tu organización.</p>
              </section>
            </>
          )}
          {status && error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </div>

      {status && !status.noticeAcceptedAt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assistant-notice-title"
          data-testid="assistant-notice"
        >
          <div className="w-full max-w-md rounded-lg border bg-popover p-4 shadow-pop">
            <h3 id="assistant-notice-title" className="font-semibold">
              {ASSISTANT_NOTICE_TITLE}
            </h3>
            <p className="mt-2 text-sm text-text-2">{ASSISTANT_COST_NOTICE}</p>
            <p className="mt-2 text-sm text-text-2">{ASSISTANT_READ_ONLY_NOTICE}</p>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => void accept()} disabled={busy} data-testid="assistant-notice-accept">
                {busy ? "Guardando…" : "Entendido, continuar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
