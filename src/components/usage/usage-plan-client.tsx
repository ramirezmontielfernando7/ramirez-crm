"use client";

import { useEffect, useState } from "react";
import { NavRevealButton } from "@/components/nav-mode";
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
  turnos,
  type Meter,
} from "@/lib/usage";
import { cn } from "@/lib/utils";
import type { OwnerUsage } from "@/server/usage/owner";

/**
 * 036 (PR 6) — «Uso y plan» del Propietario: su plan, cada medida del mes
 * contra su tope y qué función y qué agente consumen más. Solo lectura; los
 * topes los cambia el administrador de plataforma.
 */

function mesDe(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
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

const tokensYTurnos = (t: { tokens: number; turns: number }) => `${formatTokens(t.tokens)} tokens · ${turnos(t.turns)}`;

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
    <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
      <NavRevealButton />
      <h2 className="text-[17px] font-bold tracking-tight">Uso y plan</h2>
      {usage && (
        <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-text-2" data-testid="usage-plan-name">
          Plan {PLAN_LABEL[usage.limits.planKey]}
        </span>
      )}
    </header>
  );

  if (!usage) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <p className={cn("p-6 text-sm", error ? "text-destructive" : "text-text-2")}>{error ?? "Cargando tu consumo…"}</p>
      </div>
    );
  }

  const { ai, limits, storage } = usage;
  const iaMes = aiMeter(ai, { turns: limits.aiTurns.value, tokens: limits.aiTokens.value });
  // El medidor muestra la medida que va más alta; la nota, la otra (sin repetir).
  const iaNota = iaMes.text.includes("turno")
    ? `${formatTokens(ai.tokens)}${limits.aiTokens.value !== null ? ` / ${formatTokens(limits.aiTokens.value)}` : ""} tokens`
    : limits.aiTurns.value !== null
      ? `${ai.turns.toLocaleString("es-MX")} / ${limits.aiTurns.value.toLocaleString("es-MX")} turnos`
      : turnos(ai.turns);
  const funciones = AI_KINDS.filter((k) => k !== "embed" && ai.byKind[k]);
  const maxFuncion = Math.max(1, ...funciones.map((k) => ai.byKind[k]!.tokens));
  const maxAgente = Math.max(1, ...ai.byAgent.map((a) => a.tokens));

  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <div className="mx-auto max-w-5xl space-y-4" data-testid="usage-plan">
          <p className="text-sm text-text-2">
            Consumo de {mesDe(usage.period)} (el mes se cuenta en UTC) contra los topes de tu plan. Para cambiar tu plan o tus
            topes, habla con quien administra la plataforma.
          </p>

          {usage.alerts.length > 0 && (
            <div
              className="rounded-md border border-warning-soft bg-warning-tint px-4 py-2 text-sm text-warning-text"
              data-testid="usage-plan-alerts"
            >
              <p className="text-xs font-medium">Avisos de este mes</p>
              <ul className="mt-1 space-y-1">
                {usage.alerts.map((a) => (
                  <li key={a.metric}>{a.text}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Inteligencia artificial" testId="usage-plan-ai">
              <Measure label="IA del mes" meter={iaMes} testId="usage-plan-ai-meter" note={iaNota} />
              <Measure
                label="Embeddings (documentos del agente)"
                meter={countMeter(usage.embedTokens, limits.embedTokens.value, "tokens", formatTokens)}
                note={EMBED_NOTE}
                testId="usage-plan-embed-meter"
              />
            </Card>

            <Card title={STORAGE_LABEL} testId="usage-plan-storage">
              <Measure
                label="Total"
                meter={storageMeter(storage.totalBytes, limits.storageBytes.value)}
                note={limits.storageBytes.value !== null ? `Al llegar al tope: ${STORAGE_MODE_LABEL[limits.storageMode]}.` : undefined}
                testId="usage-plan-storage-meter"
              />
              <ul className="divide-y text-sm" data-testid="usage-plan-storage-categories">
                {STORAGE_CATEGORIES.map((c) => (
                  <li key={c} className="flex items-baseline justify-between gap-3 py-1">
                    <span className="min-w-0 break-words">{STORAGE_CATEGORY_LABEL[c]}</span>
                    <span className="shrink-0 tabular-nums text-text-2">{formatStorage(storage.byCategory[c])}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-text-3">{STORAGE_NOTE}</p>
            </Card>

            <Card title="Equipo y módulos" testId="usage-plan-team">
              <Measure label="Personas" meter={countMeter(usage.members, limits.members.value, usage.members === 1 && limits.members.value === null ? "persona" : "personas")} testId="usage-plan-members-meter" />
              <Measure
                label="Módulos activos"
                meter={countMeter(usage.modules.active, limits.modules.value, `de ${usage.modules.total} módulos`)}
                testId="usage-plan-modules-meter"
              />
            </Card>

            {usage.documents && (
              <Card title="Documentos del agente" testId="usage-plan-docs">
                <Measure label="Documentos" meter={countMeter(usage.documents.documents, limits.kbMaxDocuments.value, "documentos")} testId="usage-plan-docs-meter" />
                <Measure label="Fragmentos" meter={countMeter(usage.documents.chunks, limits.kbMaxChunks.value, "fragmentos")} testId="usage-plan-chunks-meter" />
                {limits.kbMaxFileBytes.value !== null && (
                  <p className="text-[11px] text-text-3">Cada documento, hasta {formatStorage(limits.kbMaxFileBytes.value)}.</p>
                )}
              </Card>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="¿Qué función consume más?" testId="usage-plan-kinds">
              {funciones.length === 0 ? (
                <p className="text-sm text-text-3">Sin consumo de IA este mes.</p>
              ) : (
                <ul className="divide-y">
                  {funciones.map((k) => (
                    <Share key={k} label={AI_KIND_LABEL[k]} value={tokensYTurnos(ai.byKind[k]!)} share={ai.byKind[k]!.tokens / maxFuncion} />
                  ))}
                </ul>
              )}
              {ai.byKind.embed && (
                <p className="text-xs text-text-3">
                  {AI_KIND_LABEL.embed}: {formatTokens(ai.byKind.embed.tokens)} tokens. {EMBED_NOTE}
                </p>
              )}
            </Card>

            <Card title="¿Qué agente consume más?" testId="usage-plan-agents">
              {ai.byAgent.length === 0 ? (
                <p className="text-sm text-text-3">Ningún agente ha usado IA este mes.</p>
              ) : (
                <ul className="divide-y">
                  {ai.byAgent.map((a) => (
                    <Share
                      key={a.agentId}
                      label={a.name ?? "Agente que ya no existe"}
                      hint={a.archived && a.name ? "Archivado" : undefined}
                      value={tokensYTurnos(a)}
                      share={a.tokens / maxAgente}
                    />
                  ))}
                </ul>
              )}
              <p className="text-xs text-text-3">La redacción y los embeddings no tienen agente.</p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
