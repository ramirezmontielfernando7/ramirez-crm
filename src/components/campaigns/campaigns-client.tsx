"use client";

import { PhoneHealthCard } from "@/components/number-health";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import type { CampaignDto } from "@/lib/campaigns";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEvents } from "@/components/use-events";
import { CampaignProgress, CampaignStatusBadge } from "./status-badge";
import { CampaignsShell } from "./campaigns-tabs";

const FILTERS = [
  { key: "all", label: "Todas" },
  { key: "sending", label: "Enviando" },
  { key: "scheduled", label: "Programadas" },
  { key: "draft", label: "Borradores" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

function kpis(list: CampaignDto[]) {
  const sent = list.reduce((n, c) => n + c.counts.sent, 0);
  const delivered = list.reduce((n, c) => n + c.delivery.delivered + c.delivery.read, 0);
  const cost = list.reduce((n, c) => n + (c.estimatedCost ?? 0), 0);
  const cur = list.find((c) => c.costCurrency)?.costCurrency ?? "";
  return [
    { label: "Campañas", value: String(list.length), hint: "en total" },
    { label: "Mensajes enviados", value: sent.toLocaleString("es-MX"), hint: "todas las campañas" },
    { label: "Entregados", value: sent > 0 ? `${Math.round((delivered / sent) * 100)} %` : "—", hint: "de los enviados" },
    { label: "Costo estimado", value: cost > 0 ? `$ ${Math.round(cost).toLocaleString("es-MX")}` : "—", hint: cur ? `${cur} · Meta cobra aparte` : "Meta cobra aparte" },
  ];
}

/** 021 — Campañas: el historial de envíos masivos del negocio. */
export function CampaignsClient() {
  const [campaigns, setCampaigns] = useState<CampaignDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const visible = (campaigns ?? []).filter(
    (c) =>
      (filter === "all" || c.status === filter) &&
      c.name.toLowerCase().includes(q.trim().toLowerCase())
  );

  const refetch = useCallback(async () => {
    const res = await fetchJson<{ campaigns: CampaignDto[] }>("/api/campaigns");
    if (!res.ok) {
      setError(`No se pudieron cargar las campañas: ${res.error}`);
      return;
    }
    setError(null);
    setCampaigns(res.data.campaigns);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

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
    onReconnect: () => void refetch(),
  });

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
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {/* Campañas v2: antes de mandar, cómo está el número. */}
        <div className="mb-4">
          <PhoneHealthCard />
        </div>
        {error && (
          <p role="alert" className="mb-3 rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        )}
        {campaigns === null ? (
          !error && <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Megaphone className="h-8 w-8 text-text-3" strokeWidth={1.5} />
            <p className="text-sm font-medium">Sin campañas todavía</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Manda una plantilla aprobada por Meta a los contactos que aceptaron recibir mensajes:
              una promoción, un servicio nuevo, un aviso.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {kpis(campaigns).map((k) => (
                <div key={k.label} className="rounded-xl border bg-card p-4">
                  <p className="text-xs text-muted-foreground">{k.label}</p>
                  <p className="mt-1 text-2xl font-semibold">{k.value}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{k.hint}</p>
                </div>
              ))}
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar campaña"
                aria-label="Buscar campaña"
                className="h-9 w-64 rounded-md border border-input bg-card px-3 text-sm"
              />
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    filter === f.key
                      ? "border-brand bg-brand-tint text-brand-text"
                      : "border-dashed text-text-2 hover:bg-accent"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                    <th className="px-4 py-3">Campaña</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Público</th>
                    <th className="px-4 py-3">Entregados</th>
                    <th className="px-4 py-3">Plantilla</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => {
                    const started = c.status !== "draft" && c.status !== "scheduled";
                    return (
                      <tr key={c.id} data-pm="row" className="border-b last:border-b-0 hover:bg-accent/40">
                        <td className="px-4 py-3">
                          <Link href={`/campaigns/${c.id}`} className="block">
                            <p className="truncate font-medium">{c.name}</p>
                            {c.status === "scheduled" && c.scheduledAt && (
                              <p className="text-[11px] text-muted-foreground">
                                Programada para {new Date(c.scheduledAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                              </p>
                            )}
                            {c.status === "paused" && c.pauseReason && (
                              <p className={`text-[11px] ${c.autoPaused ? "text-warning-text" : "text-muted-foreground"}`}>{c.pauseReason}</p>
                            )}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <CampaignStatusBadge status={c.status} />
                        </td>
                        <td className="px-4 py-3 tabular-nums">{c.total > 0 ? c.total.toLocaleString("es-MX") : "—"}</td>
                        <td className="px-4 py-3">
                          {started && c.total > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="w-24">
                                <CampaignProgress total={c.total} sent={c.counts.sent} failed={c.counts.failed + c.counts.skipped} />
                              </div>
                              <span className="tabular-nums text-xs text-muted-foreground">
                                {Math.round((c.counts.sent / c.total) * 100)} %
                              </span>
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.template?.name ?? "Plantilla eliminada"}</td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/campaigns/${c.id}`}>
                            <Button size="sm" variant="outline">
                              {c.status === "paused" && c.autoPaused ? "Revisar" : "Abrir"}
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted-foreground">
                        Ninguna campaña coincide.
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
