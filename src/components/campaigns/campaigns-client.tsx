"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Megaphone, Pause, Plus, Search } from "lucide-react";
import type { CampaignDto } from "@/lib/campaigns";
import { formatMoney, formatPct, pct, type CampaignMetricsDto } from "@/lib/campaign-metrics";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useEvents } from "@/components/use-events";
import { CampaignStatusBadge } from "./status-badge";
import { CampaignsShell } from "./campaigns-tabs";
import { CampaignBlockersBanner } from "@/components/onboarding/campaign-blockers";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * 021 — Campañas: el historial de envíos masivos del negocio. Ronda 3: cuatro
 * tarjetas del mes (de `GET /api/campaigns/metrics`, base propia), búsqueda y
 * chips por estado (en el navegador) y una tabla con el avance y las
 * respuestas de cada campaña. «Salud del número» vive en Métricas y costos.
 */

const nf = new Intl.NumberFormat("es-MX");

type Filter = "all" | "sending" | "scheduled" | "draft";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "sending", label: "Enviando" },
  { key: "scheduled", label: "Programadas" },
  { key: "draft", label: "Borradores" },
];

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { weekday: "short", hour: "numeric", minute: "2-digit" });

function Stat({ label, value, hint, testId }: { label: string; value: string; hint: string; testId: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card px-4 py-3" data-testid={testId}>
      <p className="text-xs text-text-2">{label}</p>
      <p className="mt-1 truncate text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 line-clamp-2 text-xs text-text-3">{hint}</p>
    </div>
  );
}

export function CampaignsClient({ today }: { today: string }) {
  const [campaigns, setCampaigns] = useState<CampaignDto[] | null>(null);
  const [metrics, setMetrics] = useState<CampaignMetricsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetchJson<{ campaigns: CampaignDto[] }>("/api/campaigns");
    if (!res.ok) {
      setError(`No se pudieron cargar las campañas: ${res.error}`);
      return;
    }
    setError(null);
    setCampaigns(res.data.campaigns);
  }, []);

  // Las tarjetas son del mes en curso (zona del negocio, la manda la página).
  const refetchMetrics = useCallback(async () => {
    const res = await fetchJson<CampaignMetricsDto>(`/api/campaigns/metrics?from=${today.slice(0, 7)}-01&to=${today}`);
    if (res.ok) setMetrics(res.data);
  }, [today]);

  useEffect(() => {
    void refetch();
    void refetchMetrics();
  }, [refetch, refetchMetrics]);

  useEvents({
    onCampaignProgress: (d) => {
      // Un cambio de estado (pausa, programada → enviando) trae motivo y horas: refetch.
      if (d.status !== "sending") void refetch();
      setCampaigns((prev) =>
        prev?.map((c) =>
          c.id === d.campaignId ? { ...c, status: d.status as CampaignDto["status"], counts: d.counts } : c
        ) ?? prev
      );
    },
    onReconnect: () => {
      void refetch();
      void refetchMetrics();
    },
  });

  async function pause(id: string) {
    setBusyId(id);
    const res = await fetchJson(`/api/campaigns/${id}/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "pause" }),
    });
    setBusyId(null);
    if (!res.ok) setError(res.error);
    void refetch();
  }

  const metricsById = useMemo(() => new Map((metrics?.campaigns ?? []).map((c) => [c.id, c])), [metrics]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (campaigns ?? []).filter((c) => {
      if (filter !== "all" && c.status !== filter) return false;
      if (!needle) return true;
      return c.name.toLowerCase().includes(needle) || (c.template?.name ?? "").toLowerCase().includes(needle);
    });
  }, [campaigns, filter, q]);

  const t = metrics?.totals;
  const cur = metrics?.cost.estimatedCurrency ?? metrics?.cost.reportedCurrency ?? null;

  return (
    <CampaignsShell
      actions={
        <Link href="/campaigns/new">
          <Button size="sm">
            <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Nueva campaña
          </Button>
        </Link>
      }
    >
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
        <CampaignBlockersBanner />
        <section aria-label="Resumen del mes" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat testId="camp-stat-sent" label="Mensajes este mes" value={t ? nf.format(t.sent) : "—"} hint="aceptados por Meta" />
          <Stat
            testId="camp-stat-delivered"
            label="Entregados"
            value={t ? formatPct(t.delivered, t.sent) : "—"}
            hint={t ? `${nf.format(t.delivered)} mensajes` : "este mes"}
          />
          <Stat
            testId="camp-stat-replied"
            label="Respondieron"
            value={t ? formatPct(t.replied, t.sent) : "—"}
            hint={t ? `${nf.format(t.replied)} personas` : "este mes"}
          />
          <Stat
            testId="camp-stat-cost"
            label="Costo estimado"
            value={metrics ? formatMoney(metrics.cost.estimated, cur) : "—"}
            hint={
              metrics?.cost.estimated === null && (t?.sent ?? 0) > 0
                ? "sin tarifas: revísalas en Ajustes de envío"
                : metrics?.cost.estimated === null
                  ? "se calcula al enviar · tarifas de México"
                  : "aproximado · Meta cobra aparte"
            }
          />
        </section>

        {error && (
          <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        )}

        {campaigns === null ? (
          !error && <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="Sin campañas todavía"
            description="Manda una plantilla aprobada por Meta a los contactos que aceptaron recibir mensajes: una promoción, un servicio nuevo, un aviso."
            action={
              <Link href="/campaigns/new">
                <Button size="sm">
                  <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
                  Nueva campaña
                </Button>
              </Link>
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label className="relative block w-full max-w-[260px]">
                <span className="sr-only">Buscar campaña</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-3" />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar campaña"
                  className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-3 text-sm placeholder:text-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={filter === f.key}
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      filter === f.key
                        ? "border-brand bg-brand-tint text-brand-text"
                        : "text-text-2 hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full min-w-[860px] text-sm" data-testid="campaigns-table">
                <thead className="bg-subtle text-left text-xs text-text-3">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Campaña</th>
                    <th className="px-3 py-2.5 font-medium">Estado</th>
                    <th className="px-3 py-2.5 text-right font-medium">Público</th>
                    <th className="px-3 py-2.5 font-medium">Entregados</th>
                    <th className="px-3 py-2.5 text-right font-medium">Respondieron</th>
                    <th className="px-3 py-2.5 font-medium">Plantilla</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => {
                    const started = c.status !== "draft" && c.status !== "scheduled";
                    const deliveredPct = started ? pct(c.delivery.delivered, c.counts.sent) : null;
                    const m = metricsById.get(c.id);
                    return (
                      <tr key={c.id} data-pm="row" className="border-t align-top transition-colors hover:bg-accent/50">
                        <td className="px-4 py-3">
                          <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                            {c.name}
                          </Link>
                          {c.status === "paused" && c.pauseReason && (
                            <p className={cn("mt-0.5 text-[11px]", c.autoPaused ? "text-danger-text" : "text-text-3")}>
                              {c.pauseReason}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <CampaignStatusBadge status={c.status} />
                          {c.status === "scheduled" && c.scheduledAt && (
                            <p className="mt-0.5 text-[11px] text-text-3">{fmtWhen(c.scheduledAt)}</p>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{c.total > 0 ? nf.format(c.total) : "—"}</td>
                        <td className="px-3 py-3">
                          {deliveredPct === null ? (
                            <span className="text-text-3">—</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
                                <div className="h-full bg-brand" style={{ width: `${Math.min(100, deliveredPct)}%` }} />
                              </div>
                              <span className="tabular-nums text-text-2">{formatPct(c.delivery.delivered, c.counts.sent)}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {m && m.sent > 0 ? formatPct(m.replied, m.sent) : <span className="text-text-3">—</span>}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-text-2">{c.template?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-right">
                          {c.status === "sending" ? (
                            <Button size="sm" variant="outline" disabled={busyId === c.id} onClick={() => void pause(c.id)}>
                              <Pause className="mr-1.5 h-3.5 w-3.5" />
                              Pausar
                            </Button>
                          ) : (
                            <Link href={`/campaigns/${c.id}`}>
                              <Button size="sm" variant="outline">
                                {c.status === "paused" ? "Revisar" : "Abrir"}
                              </Button>
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-text-3">
                        Ninguna campaña coincide con la búsqueda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </CampaignsShell>
  );
}
