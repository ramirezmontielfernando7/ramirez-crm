"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PauseCircle, X } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { useViewer } from "@/components/viewer-context";
import { useEvents } from "@/components/use-events";

type Paused = { id: string; name: string; reason: string | null; resumeAt: string | null };

const REFRESH_MS = 60_000;

/**
 * Campañas v2 — Aviso en la app cuando la pausa de seguridad detiene una
 * campaña (Propietario y Coordinador: `campaigns.manage`). Se actualiza en
 * vivo con el SSE de campañas y, por si acaso, cada minuto. Cerrarlo lo
 * oculta hasta que cambie la lista de campañas pausadas.
 */
export function CampaignPauseBanner({ campaigns }: { campaigns: boolean }) {
  const viewer = useViewer();
  const allowed = campaigns && viewer.can("campaigns.manage");
  const [paused, setPaused] = useState<Paused[]>([]);
  const [dismissed, setDismissed] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchJson<{ paused: Paused[] }>("/api/campaigns/alerts");
    if (res.ok) setPaused(res.data.paused);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [allowed, load]);

  useEvents({
    onCampaignProgress: (d) => {
      if (allowed && d.status !== "sending") void load();
    },
  });

  const key = paused.map((p) => p.id).join(",");
  if (!allowed || paused.length === 0 || dismissed === key) return null;
  const first = paused[0]!;
  return (
    <div
      role="alert"
      data-testid="campaign-pause-banner"
      className="flex shrink-0 items-start gap-2 border-b border-warning-soft bg-warning-tint px-4 py-2 text-sm"
    >
      <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Campaña en pausa de seguridad: </span>
        <Link href={`/campaigns/${first.id}`} className="font-medium underline underline-offset-2">
          {first.name}
        </Link>
        {first.reason ? ` — ${first.reason.replace(/^Pausa de seguridad:\s*/, "")}` : ""}
        {paused.length > 1 && ` (+${paused.length - 1} más)`}
      </p>
      <button
        type="button"
        aria-label="Cerrar aviso"
        className="rounded p-0.5 hover:bg-warning-soft"
        onClick={() => setDismissed(key)}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
