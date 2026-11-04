"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { UsageMeter } from "@/components/usage/usage-meter";
import { fetchJson } from "@/lib/fetch-json";
import { PLAN_LABEL, STORAGE_MODE_LABEL } from "@/lib/limits";
import {
  AI_KIND_LABEL,
  AI_KINDS,
  aiMeter,
  countMeter,
  EMBED_NOTE,
  formatStorage,
  formatTokens,
  STORAGE_CATEGORIES,
  STORAGE_CATEGORY_LABEL,
  STORAGE_LABEL,
  STORAGE_NOTE,
  storageMeter,
  type Meter,
} from "@/lib/usage";
import { gaugeMeter, type Gauge } from "@/lib/usage-visibility";
import { cn } from "@/lib/utils";
import type { OwnerUsage } from "@/server/usage/owner";

/**
 * 036 (PR 6) — «Uso y plan» del Propietario: su plan, cada medida del mes
 * contra su tope y qué función y qué agente consumen más. Solo lectura; los
 * topes los cambia el administrador de plataforma.
 *
 * 038 (PR 1): la IA llega ya recortada por el servidor a la visibilidad de la
 * organización: cifras solo con `tokens`; con `percent`, porcentajes; con
 * `status`, «Disponible» / «Agotado» y sin desglose.
 */

function mesDe(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** «1 de diciembre»: el primer día del mes siguiente al periodo. */
function renovacion(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return "inicio del mes siguiente";
  return new Date(Date.UTC(y, m, 1)).toLocaleDateString("es-MX", { day: "numeric", month: "long", timeZone: "UTC" });
}

function Card({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="min-w-0 rounded-md border bg-card p-4" data-testid={testId}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/** Una medida contra su tope: etiqueta, medidor y una nota opcional. */
function Measure({ label, meter, note, testId }: { label: string; meter: Meter; note?: string; testId: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-text-2">{label}</p>
      <UsageMeter meter={meter} label={label} testId={testId} showLabel="never" />
      {note && <p className="mt-1 text-[11px] text-text-3">{note}</p>}
    </div>
  );
}

/** Una fila de «quién consume más» con su parte del total. */
function Share({ label, hint, value, share }: { label: string; hint?: string; value: string; share: number }) {
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0">
          <span className="break-words">{label}</span>
          {hint && <span className="ml-1.5 text-xs text-text-3">{hint}</span>}
        </span>
        <span className="shrink-0 tabular-nums text-text-2">{value}</span>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(Math.min(1, share) * 100)}%` }} />
      </div>
    </li>
  );
}

// 0071: los turnos ya no se enseñan al cliente (solo tokens).
const soloTokens = (t: { tokens: number }) => `${formatTokens(t.tokens)} tokens`;

/** Lo que dice una fila de «quién consume más»: cifras con `tokens`, si no su parte del total. */
const shareValue = (l: { share: number; tokens?: number; turns?: number }) =>
  l.tokens !== undefined ? soloTokens({ tokens: l.tokens }) : `${Math.round(l.share * 100)} %`;

/** El medidor de una medida de IA: con cifras (`tokens`) o con porcentaje/estado. */
function gaugeOrCount(g: Gauge, unit: string): Meter {
  return g.used !== undefined ? countMeter(g.used, g.limit ?? null, unit, formatTokens) : gaugeMeter(g);
}

export function UsagePlanClient() {
  const [usage, setUsage] = useState<OwnerUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void fetchJson<{ usage: OwnerUsage }>("/api/usage").then((r) => {
      if (!vivo) return;
      if (r.ok) setUsage(r.data.usage);
      else setError(r.error);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const header = (
    // 039: vive en Ajustes → Uso y plan; el encabezado de 56 px es el de Ajustes.
    // 0070 (maqueta 4): el plan como título y una línea con el mes.
    <div className="mb-4">
      <h2 className="text-lg font-semibold tracking-tight" data-testid="usage-plan-name">
        {usage ? PLAN_LABEL[usage.limits.planKey] : "Uso y plan"}
      </h2>
      {usage && (
        <p className="text-sm text-text-2">
          Tu consumo de {mesDe(usage.period).replace(/ de \d{4}$/, "")}. Se renueva el {renovacion(usage.period)}.
        </p>
      )}
    </div>
  );

  if (!usage) {
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <p className={cn("text-sm", error ? "text-destructive" : "text-text-2")}>{error ?? "Cargando tu consumo…"}</p>
      </div>
    );
  }

  const { ai, limits, storage } = usage;
  const { tokens: tk, turns: tu, usd } = ai.total;
  const cifras = tk !== undefined || usd !== undefined;
  const dolares = (n: number) => `${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
  const iaMes: Meter =
    tk !== undefined && tu !== undefined
      ? aiMeter({ tokens: tk.used, turns: tu.used }, { tokens: tk.limit, turns: tu.limit })
      : tk !== undefined
        ? countMeter(tk.used, tk.limit, "tokens", formatTokens)
        : usd !== undefined
          ? { ...countMeter(usd.used, usd.limit, "", (n) => n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })), text: `${dolares(usd.used)} de ${dolares(usd.limit)}` }
          : gaugeMeter(ai.total);
  const pct = ai.total.percent;
  const queda = pct === null ? null : Math.max(0, 100 - pct);
  const orden = (k: string) => AI_KINDS.indexOf(k as (typeof AI_KINDS)[number]);
  const funciones = ai.byKind ? [...ai.byKind].sort((a, b) => orden(a.key) - orden(b.key)) : null;
  const maxFuncion = Math.max(0.0001, ...(funciones ?? []).map((l) => l.share));
  const maxAgente = Math.max(0.0001, ...(ai.byAgent ?? []).map((a) => a.share));
  const fin = renovacion(usage.period);

  const filas: { label: string; meter: Meter; testId: string }[] = [
    { label: "Almacenamiento", meter: storageMeter(storage.totalBytes, limits.storageBytes.value), testId: "usage-plan-storage-meter" },
    {
      label: "Personas del equipo",
      meter: countMeter(usage.members, limits.members.value, usage.members === 1 && limits.members.value === null ? "persona" : "personas"),
      testId: "usage-plan-members-meter",
    },
    { label: "Módulos activos", meter: countMeter(usage.modules.active, limits.modules.value, `de ${usage.modules.total} módulos`), testId: "usage-plan-modules-meter" },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="usage-plan">
      {header}

      {usage.alerts.length > 0 && (
        <div className="rounded-md border border-warning-soft bg-warning-tint px-4 py-2 text-sm text-warning-text" data-testid="usage-plan-alerts">
          <p className="text-xs font-medium">Avisos de este mes</p>
          <ul className="mt-1 space-y-1">
            {usage.alerts.map((a) => (
              <li key={a.metric}>{a.text}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="rounded-xl border bg-card p-5" data-testid="usage-plan-ai">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Inteligencia artificial</h3>
            <p className="text-sm text-text-2">Agentes, asistente y creador de agentes</p>
          </div>
          <div className="text-right" data-testid="usage-plan-ai-meter" title={iaMes.detail}>
            <p className={cn("text-2xl font-semibold tabular-nums", iaMes.tone === "danger" && "text-danger-text", iaMes.tone === "warning" && "text-warning-text")}>
              {pct !== null ? `${Math.min(pct, 100)} %` : iaMes.text}
            </p>
            {/* El texto exacto del medidor (cifras con `tokens`; «% del tope» si no). */}
            <span className={cn(cifras ? "block text-xs text-text-3" : "sr-only")}>{iaMes.text}</span>
          </div>
        </div>
        {iaMes.ratio !== null && (
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="IA del mes" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(iaMes.ratio * 100))}>
            <div
              className={cn("h-full rounded-full", iaMes.tone === "danger" ? "bg-destructive" : iaMes.tone === "warning" ? "bg-warning" : "bg-brand")}
              style={{ width: `${Math.min(100, Math.round(iaMes.ratio * 100))}%` }}
            />
          </div>
        )}
        <p className="mt-3 text-sm text-text-2">
          {ai.total.state === "exhausted"
            ? `Llegaste al 100 %: los agentes pasan los chats a tu equipo hasta el ${fin}.`
            : queda !== null
              ? `Te queda ${queda} %. Si llegas al 100 %, los agentes pasan los chats a tu equipo hasta el ${fin}.`
              : "Si llegas al tope, los agentes pasan los chats a tu equipo hasta que se renueve."}
        </p>
      </section>

      <section className="divide-y rounded-xl border bg-card px-5" data-testid="usage-plan-team">
        {filas.map((f) => (
          <div key={f.testId} className="grid items-center gap-x-4 gap-y-1 py-3.5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,12rem)]" title={f.meter.detail} data-testid={f.testId} data-tone={f.meter.tone}>
            <span className="text-sm">{f.label}</span>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              {f.meter.ratio !== null && (
                <div
                  className={cn("h-full rounded-full", f.meter.tone === "danger" ? "bg-destructive" : f.meter.tone === "warning" ? "bg-warning" : "bg-brand")}
                  style={{ width: `${Math.min(100, Math.round(f.meter.ratio * 100))}%` }}
                />
              )}
            </div>
            <span className={cn("text-sm tabular-nums sm:text-right", f.meter.tone === "danger" ? "text-danger-text" : "text-text-2")}>{f.meter.text}</span>
          </div>
        ))}
      </section>

      <details className="group" data-testid="usage-plan-detail">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-sm">
          <span className="inline-flex items-center gap-1 text-brand-text">
            <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
            Ver detalle por agente y función
          </span>
          <span className="text-text-3">¿Necesitas más? Habla con quien administra la plataforma.</span>
        </summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {funciones && ai.byAgent && (
            <>
              <Card title="¿Qué función consume más?" testId="usage-plan-kinds">
                {funciones.length === 0 ? (
                  <p className="text-sm text-text-3">Sin consumo de IA este mes.</p>
                ) : (
                  <ul className="divide-y">
                    {funciones.map((l) => (
                      <Share key={l.key} label={AI_KIND_LABEL[l.key]} value={shareValue(l)} share={l.share / maxFuncion} />
                    ))}
                  </ul>
                )}
                {!cifras && <p className="text-xs text-text-3">Porcentaje de la IA usada este mes (sin embeddings).</p>}
              </Card>
              <Card title="¿Qué agente consume más?" testId="usage-plan-agents">
                {ai.byAgent.length === 0 ? (
                  <p className="text-sm text-text-3">Ningún agente ha usado IA este mes.</p>
                ) : (
                  <ul className="divide-y">
                    {ai.byAgent.map((a) => (
                      <Share
                        key={a.key}
                        label={a.name ?? "Agente que ya no existe"}
                        hint={a.archived && a.name ? "Archivado" : undefined}
                        value={shareValue(a)}
                        share={a.share / maxAgente}
                      />
                    ))}
                  </ul>
                )}
                <p className="text-xs text-text-3">La redacción, el asistente interno y los embeddings no tienen agente.</p>
              </Card>
            </>
          )}
          <Card title="Otras medidas de IA" testId="usage-plan-ai-more">
            <Measure label="Embeddings (documentos del agente)" meter={gaugeOrCount(ai.embed, "tokens")} note={EMBED_NOTE} testId="usage-plan-embed-meter" />
            {ai.assistant && (
              <Measure
                label="Asistente interno"
                meter={gaugeOrCount(ai.assistant, "tokens")}
                note="Tiene su propio tope y cuenta también en la IA del mes."
                testId="usage-plan-assistant-meter"
              />
            )}
          </Card>
          <Card title={STORAGE_LABEL} testId="usage-plan-storage">
            <ul className="divide-y text-sm" data-testid="usage-plan-storage-categories">
              {STORAGE_CATEGORIES.map((c) => (
                <li key={c} className="flex items-baseline justify-between gap-3 py-1">
                  <span className="min-w-0 break-words">{STORAGE_CATEGORY_LABEL[c]}</span>
                  <span className="shrink-0 tabular-nums text-text-2">{formatStorage(storage.byCategory[c])}</span>
                </li>
              ))}
            </ul>
            {limits.storageBytes.value !== null && <p className="text-[11px] text-text-3">Al llegar al tope: {STORAGE_MODE_LABEL[limits.storageMode]}.</p>}
            <p className="text-[11px] text-text-3">{STORAGE_NOTE}</p>
          </Card>
        </div>
      </details>
    </div>
  );
}
