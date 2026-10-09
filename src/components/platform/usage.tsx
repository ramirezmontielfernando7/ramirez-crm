"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  AI_KIND_LABEL,
  AI_KINDS,
  aiMeter,
  EMBED_NOTE,
  formatStorage,
  formatTokens,
  STORAGE_CATEGORIES,
  STORAGE_CATEGORY_LABEL,
  STORAGE_LABEL,
  STORAGE_NOTE,
  storageMeter,
  turnos,
  type Meter,
  type MeterTone,
} from "@/lib/usage";
import { api, mesDe, type OrgUsageDetail } from "./api";

/**
 * 036 (PR 4) — Cómo se ve el consumo en /platform: un medidor fino (texto +
 * barra) y, al abrir la fila, el detalle del mes. Solo lectura.
 */

const FILL: Record<MeterTone, string> = {
  normal: "bg-brand",
  warning: "bg-warning",
  danger: "bg-destructive",
};

export function UsageMeter({
  meter,
  label,
  testId,
  showLabel = "mobile",
}: {
  meter: Meter;
  label: string;
  testId?: string;
  /** La etiqueta visible: solo en el celular (la lista tiene encabezados) o nunca. */
  showLabel?: "mobile" | "never";
}) {
  const pct = meter.ratio === null ? null : Math.min(100, Math.round(meter.ratio * 100));
  return (
    <div className="min-w-0" title={meter.detail} data-testid={testId} data-tone={meter.tone}>
      {showLabel === "mobile" && <span className="block text-[11px] text-text-3 sm:hidden">{label}</span>}
      <span
        className={cn(
          "block truncate text-xs tabular-nums",
          meter.tone === "danger" ? "text-danger-text" : meter.tone === "warning" ? "text-warning-text" : "text-text-2"
        )}
      >
        {meter.text}
      </span>
      {pct !== null && (
        <div
          className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className={cn("h-full rounded-full", FILL[meter.tone])} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** Una fila «etiqueta ……… valor» del detalle. */
function Line({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="min-w-0">
        <span className="break-words">{label}</span>
        {hint && <span className="block text-xs text-text-3">{hint}</span>}
      </span>
      <span className="shrink-0 tabular-nums text-text-2">{value}</span>
    </li>
  );
}

const tokensYTurnos = (t: { tokens: number; turns: number }) => `${formatTokens(t.tokens)} tokens · ${turnos(t.turns)}`;

/** El consumo del mes de UNA organización (se pide al abrir su fila). */
export function UsageDetail({ orgId, storageLimitBytes = null }: { orgId: string; storageLimitBytes?: number | null }) {
  const [detail, setDetail] = useState<OrgUsageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void api<{ usage: OrgUsageDetail }>(`/api/platform/organizations/${orgId}/usage`).then((r) => {
      if (!vivo) return;
      if (r.data) setDetail(r.data.usage);
      else setError(r.error ?? "No se pudo leer el consumo");
    });
    return () => {
      vivo = false;
    };
  }, [orgId]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!detail) return <p className="text-sm text-text-2">Cargando consumo…</p>;

  const { ai, storage } = detail;
  const cuota = aiMeter(ai, ai.limits);
  const funciones = AI_KINDS.filter((k) => k !== "embed" && ai.byKind[k]);
  const embed = ai.byKind.embed;

  return (
    <div className="grid gap-5 md:grid-cols-2" data-testid="platform-usage-detail">
      <section className="min-w-0 space-y-2">
        <h4 className="text-xs font-medium text-text-2">IA de {mesDe(detail.period)} (UTC)</h4>
        <UsageMeter meter={cuota} label="IA del mes" testId="platform-usage-ai" showLabel="never" />
        <p className="text-xs text-text-3">{cuota.detail}</p>

        <div>
          <p className="mt-3 text-xs font-medium text-text-2">Por función</p>
          {funciones.length === 0 && !embed ? (
            <p className="py-1 text-sm text-text-3">Sin consumo este mes.</p>
          ) : (
            <ul className="divide-y" data-testid="platform-usage-kinds">
              {funciones.map((k) => (
                <Line key={k} label={AI_KIND_LABEL[k]} value={tokensYTurnos(ai.byKind[k]!)} />
              ))}
              {embed && (
                <Line label={AI_KIND_LABEL.embed} hint={EMBED_NOTE} value={`${formatTokens(embed.tokens)} tokens`} />
              )}
            </ul>
          )}
        </div>

        <div>
          <p className="mt-3 text-xs font-medium text-text-2">Por agente</p>
          {ai.byAgent.length === 0 ? (
            <p className="py-1 text-sm text-text-3">Sin consumo de agentes este mes.</p>
          ) : (
            <ul className="divide-y" data-testid="platform-usage-agents">
              {ai.byAgent.map((a) => (
                <Line
                  key={a.agentId}
                  label={a.name ?? "Agente que ya no existe"}
                  hint={a.archived && a.name ? "Archivado" : undefined}
                  value={tokensYTurnos(a)}
                />
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-text-3">
            La redacción y los embeddings no tienen agente. El desglose por agente existe desde que se desplegó.
          </p>
        </div>
      </section>

      <section className="min-w-0 space-y-2">
        <h4 className="text-xs font-medium text-text-2">{STORAGE_LABEL}</h4>
        <UsageMeter
          meter={storageMeter(storage.totalBytes, storageLimitBytes)}
          label={STORAGE_LABEL}
          testId="platform-usage-storage-total"
          showLabel="never"
        />
        <ul className="divide-y" data-testid="platform-usage-storage">
          {STORAGE_CATEGORIES.map((c) => (
            <Line key={c} label={STORAGE_CATEGORY_LABEL[c]} value={formatStorage(storage.byCategory[c])} />
          ))}
        </ul>
        {storage.filesWithoutSize > 0 && (
          <p className="text-xs text-text-3">
            {storage.filesWithoutSize} archivo(s) sin tamaño registrado: no suman.
          </p>
        )}
        <p className="text-xs text-text-3">{STORAGE_NOTE}</p>
      </section>
    </div>
  );
}
