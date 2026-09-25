"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import type { CampaignDto } from "@/lib/campaigns";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { useEvents } from "@/components/use-events";
import { CampaignProgress, CampaignStatusBadge } from "./status-badge";

/** 021 — Campañas: el historial de envíos masivos del negocio. */
export function CampaignsClient() {
  const [campaigns, setCampaigns] = useState<CampaignDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    onCampaignProgress: (d) =>
      setCampaigns((prev) =>
        prev?.map((c) =>
          c.id === d.campaignId ? { ...c, status: d.status as CampaignDto["status"], counts: d.counts } : c
        ) ?? prev
      ),
    onReconnect: () => void refetch(),
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <h2 className="text-[17px] font-bold tracking-tight">Campañas</h2>
        <Link href="/campaigns/new">
          <Button size="sm">
            <Plus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Nueva campaña
          </Button>
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {error && (
          <p role="alert" className="mb-3 rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        )}
        {campaigns === null ? (
          !error && <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : campaigns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Megaphone className="h-8 w-8 text-text-3" strokeWidth={1.5} />
            <p className="text-sm font-medium">Sin campañas todavía</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Manda una plantilla aprobada por Meta a los contactos que aceptaron recibir mensajes:
              una promoción, un servicio nuevo, un aviso.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {campaigns.map((c) => {
              const done = c.counts.sent + c.counts.failed;
              return (
                <li key={c.id}>
                  <Link
                    href={`/campaigns/${c.id}`}
                    className="block rounded-lg border bg-card px-4 py-3 transition-colors hover:bg-accent"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.template?.name ?? "Plantilla eliminada"} ·{" "}
                          {new Date(c.createdAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                        </p>
                      </div>
                      <CampaignStatusBadge status={c.status} />
                    </div>
                    {c.status !== "draft" && (
                      <div className="mt-2 space-y-1">
                        <CampaignProgress total={c.total} sent={c.counts.sent} failed={c.counts.failed} />
                        <p className="text-[11px] text-muted-foreground">
                          {c.counts.sent} de {c.total} enviados
                          {c.counts.failed > 0 ? ` · ${c.counts.failed} fallidos` : ""}
                          {c.status === "sending" ? ` · ${c.total - done} pendientes` : ""}
                        </p>
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
