"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, CalendarClock, Download, Pause, Play, Send, Trash2, XCircle } from "lucide-react";
import {
  DELIVERY_STATUS_LABEL,
  EXCLUSION_LABEL,
  type ExclusionReason,
  RECIPIENT_STATUS_LABEL,
  resolveVariables,
  type DeliveryStatus,
  type CampaignDto,
  type CampaignRecipientDto,
  type RecipientStatus,
} from "@/lib/campaigns";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { renderBody } from "@/lib/templates";
import { formatPhone } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEvents } from "@/components/use-events";
import { CampaignProgress, CampaignStatusBadge } from "./status-badge";
import { NavRevealButton } from "@/components/nav-mode";

const TABS: { key: RecipientStatus | "all"; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "sent", label: "Enviados" },
  { key: "failed", label: "Fallidos" },
  { key: "skipped", label: "Omitidos" },
  { key: "pending", label: "Pendientes" },
];

const RECIPIENT_BADGE: Record<RecipientStatus, "success" | "destructive" | "secondary"> = {
  sent: "success",
  failed: "destructive",
  pending: "secondary",
  sending: "secondary",
  skipped: "secondary",
};

const DELIVERY_BADGE: Record<DeliveryStatus, "success" | "destructive" | "secondary"> = {
  pending: "secondary",
  sent: "secondary",
  delivered: "success",
  read: "success",
  failed: "destructive",
};

/**
 * 021 — Detalle de una campaña: avance en vivo (SSE), resumen final y el log
 * de auditoría por destinatario, descargable ("se mandó a 340 de 350, 10
 * fallaron por X").
 */
export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [campaign, setCampaign] = useState<CampaignDto | null>(null);
  const [recipients, setRecipients] = useState<CampaignRecipientDto[]>([]);
  const [tab, setTab] = useState<RecipientStatus | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadCampaign = useCallback(async () => {
    const res = await fetchJson<{ campaign: CampaignDto }>(`/api/campaigns/${campaignId}`);
    if (!res.ok) {
      setError(res.status === 404 ? "Esta campaña no existe" : `No se pudo cargar la campaña: ${res.error}`);
      return;
    }
    setError(null);
    setCampaign(res.data.campaign);
  }, [campaignId]);

  const loadRecipients = useCallback(async () => {
    const qs = tab === "all" ? "" : `?status=${tab}`;
    const res = await fetchJson<{ recipients: CampaignRecipientDto[] }>(
      `/api/campaigns/${campaignId}/recipients${qs}`
    );
    if (!res.ok) {
      setError(`No se pudo cargar el detalle de envíos: ${res.error}`);
      return;
    }
    setRecipients(res.data.recipients);
  }, [campaignId, tab]);

  useEffect(() => {
    void loadCampaign();
  }, [loadCampaign]);
  useEffect(() => {
    void loadRecipients();
  }, [loadRecipients]);

  useEvents({
    onCampaignProgress: (d) => {
      if (d.campaignId !== campaignId) return;
      setCampaign((c) => (c ? { ...c, status: d.status as CampaignDto["status"], counts: d.counts } : c));
      // Al terminar se recarga todo (error final, hora de fin, lista).
      if (d.status !== "sending") {
        void loadCampaign();
        void loadRecipients();
      }
    },
    onReconnect: () => {
      void loadCampaign();
      void loadRecipients();
    },
  });

  // Mientras envía, la lista se refresca cada pocos segundos (los conteos ya
  // llegan en vivo por SSE; la lista completa no viaja por el evento).
  useEffect(() => {
    if (campaign?.status !== "sending" && campaign?.status !== "scheduled") return;
    const t = setInterval(() => void loadRecipients(), 4000);
    return () => clearInterval(t);
  }, [campaign?.status, loadRecipients]);

  async function sendDraft() {
    setBusy(true);
    setActionError(null);
    const res = await fetchJson<{ campaign: CampaignDto }>(`/api/campaigns/${campaignId}/send`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      setActionError(`No se inició el envío: ${res.error}`);
      return;
    }
    setCampaign(res.data.campaign);
    void loadRecipients();
  }

  async function setState(action: "pause" | "resume" | "cancel") {
    if (action === "cancel" && !window.confirm("¿Cancelar la campaña? A quien aún no le llegó, ya no le llegará.")) return;
    setBusy(true);
    setActionError(null);
    const res = await fetchJson<{ campaign: CampaignDto }>(`/api/campaigns/${campaignId}/state`, jsonInit("POST", { action }));
    setBusy(false);
    if (!res.ok) {
      setActionError(res.error);
      return;
    }
    setCampaign(res.data.campaign);
    void loadRecipients();
  }

  async function deleteDraft() {
    if (!window.confirm("¿Borrar este borrador?")) return;
    setBusy(true);
    const res = await fetchJson(`/api/campaigns/${campaignId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setActionError(`No se borró: ${res.error}`);
      return;
    }
    router.push("/campaigns");
  }

  if (error && !campaign) {
    return (
      <div className="p-6">
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
        <Link href="/campaigns" className="mt-2 inline-block text-sm text-brand-text underline">
          Volver a Campañas
        </Link>
      </div>
    );
  }
  if (!campaign) return <p className="p-6 text-sm text-muted-foreground">Cargando…</p>;

  const { counts, total } = campaign;
  const sample = campaign.template
    ? renderBody(
        campaign.template.body,
        resolveVariables(campaign.variables, "Ana López").map((v, i) => {
          const def = campaign.variables[i];
          return v || (def?.kind === "column" ? `[${def.column}]` : "");
        })
      )
    : null;
  const canPause = campaign.status === "sending" || campaign.status === "scheduled";
  const canResume = campaign.status === "paused";
  const canCancel = canPause || canResume;
  const excluded = (Object.entries(campaign.excluded ?? {}) as [ExclusionReason, number][]).filter(([, n]) => n > 0);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <NavRevealButton />
        <Link href="/campaigns" aria-label="Volver a Campañas">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h2 className="min-w-0 truncate text-[17px] font-bold tracking-tight">{campaign.name}</h2>
        <CampaignStatusBadge status={campaign.status} />
        {(canPause || canResume || canCancel) && (
          <div className="ml-auto flex flex-wrap gap-2" data-testid="campaign-actions">
            {canPause && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void setState("pause")} data-testid="campaign-pause">
                <Pause className="mr-1 h-4 w-4" /> Pausar
              </Button>
            )}
            {canResume && (
              <Button size="sm" disabled={busy} onClick={() => void setState("resume")} data-testid="campaign-resume">
                <Play className="mr-1 h-4 w-4" /> Reanudar
              </Button>
            )}
            {canCancel && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void setState("cancel")} data-testid="campaign-cancel">
                <XCircle className="mr-1 h-4 w-4" /> Cancelar
              </Button>
            )}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl space-y-6">
          {error && (
            <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
              {error}
            </p>
          )}
          {actionError && campaign.status !== "draft" && (
            <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
              {actionError}
            </p>
          )}
          {campaign.status === "paused" && campaign.pauseReason && (
            <div
              data-testid="campaign-pause-reason"
              className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                campaign.autoPaused ? "border-warning-soft bg-warning-tint text-warning-text" : "bg-subtle"
              }`}
            >
              <Pause className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <b>{campaign.autoPaused ? "Pausa de seguridad:" : "En pausa:"}</b>{" "}
                {campaign.pauseReason.replace(/^Pausa de seguridad:\s*/, "")}
                {campaign.resumeAt &&
                  ` Se reintenta sola a las ${new Date(campaign.resumeAt).toLocaleTimeString("es-MX", { timeStyle: "short" })}.`}
              </p>
            </div>
          )}
          {campaign.status === "scheduled" && campaign.scheduledAt && (
            <div className="flex items-start gap-2 rounded-md border bg-subtle p-3 text-sm" data-testid="campaign-scheduled">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Programada para el{" "}
                <b>{new Date(campaign.scheduledAt).toLocaleString("es-MX", { dateStyle: "full", timeStyle: "short" })}</b>.
                Puedes pausarla o cancelarla antes.
              </p>
            </div>
          )}
          {campaign.status === "failed" && campaign.error && (
            <div className="flex items-start gap-2 rounded-md border border-danger-soft bg-danger-tint p-3 text-sm text-danger-text">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <b>Envío detenido:</b> {campaign.error}
                {counts.pending > 0 && ` Quedaron ${counts.pending} sin enviar.`}
              </p>
            </div>
          )}

          {campaign.status === "draft" ? (
            <Card>
              <CardHeader>
                <CardTitle>Borrador</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Aún no se envía. Al enviar se toman los contactos con consentimiento que cumplan el
                  filtro en ese momento.
                </p>
                {actionError && (
                  <p role="alert" className="text-sm text-danger-text">
                    {actionError}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button disabled={busy} onClick={() => void sendDraft()}>
                    <Send className="mr-1.5 h-4 w-4" /> Enviar ahora
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void deleteDraft()}>
                    <Trash2 className="mr-1.5 h-4 w-4" /> Borrar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="space-y-3 pt-5">
                <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5" data-testid="campaign-counts">
                  <Stat label="destinatarios" value={total} />
                  <Stat label="enviados" value={counts.sent} />
                  <Stat label="fallidos" value={counts.failed} danger={counts.failed > 0} />
                  <Stat label="omitidos" value={counts.skipped} />
                  <Stat label="pendientes" value={counts.pending + counts.sending} />
                </div>
                {counts.sent > 0 && (
                  <div className="grid grid-cols-3 gap-2 text-center" data-testid="campaign-delivery">
                    <Stat label="entregados" value={campaign.delivery.delivered} />
                    <Stat label="leídos" value={campaign.delivery.read} />
                    <Stat
                      label="no entregados"
                      value={campaign.delivery.failed}
                      danger={campaign.delivery.failed > 0}
                    />
                  </div>
                )}
                <CampaignProgress total={total} sent={counts.sent} failed={counts.failed + counts.skipped} />
                {(excluded.length > 0 || campaign.estimatedCost !== null) && (
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground" data-testid="campaign-launch-info">
                    {excluded.length > 0 && (
                      <p>
                        Excluidos al lanzar:{" "}
                        {excluded.map(([r, n]) => `${n} ${EXCLUSION_LABEL[r].toLowerCase()}`).join(" · ")}
                      </p>
                    )}
                    {campaign.estimatedCost !== null && (
                      <p>
                        Costo{" "}
                        <span className="rounded bg-warning-tint px-1 text-warning-text">Estimado</span>:{" "}
                        {campaign.estimatedCost.toLocaleString("es-MX", { maximumFractionDigits: 2 })} {campaign.costCurrency ?? ""}
                      </p>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {campaign.startedAt &&
                    `Inició ${new Date(campaign.startedAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}`}
                  {campaign.finishedAt &&
                    ` · terminó ${new Date(campaign.finishedAt).toLocaleString("es-MX", { timeStyle: "short" })}`}
                  {campaign.status === "sending" && " · enviando en segundo plano; puedes cerrar esta pantalla"}
                </p>
              </CardContent>
            </Card>
          )}

          {sample && (
            <Card>
              <CardHeader>
                <CardTitle>Mensaje</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-1 text-xs text-muted-foreground">
                  Plantilla {campaign.template?.name} · ejemplo para «Ana López»:
                </p>
                <p className="whitespace-pre-wrap rounded-md border bg-subtle p-3 text-sm">{sample}</p>
              </CardContent>
            </Card>
          )}

          {campaign.status !== "draft" && (
            <Card>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle>Destinatarios</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <a href={`/api/campaigns/${campaignId}/recipients?format=csv`} download>
                    <Button size="sm" variant="outline" type="button">
                      <Download className="mr-1.5 h-4 w-4" /> Todo (CSV)
                    </Button>
                  </a>
                  {counts.failed > 0 && (
                    <a href={`/api/campaigns/${campaignId}/recipients?format=csv&status=failed`} download>
                      <Button size="sm" variant="outline" type="button">
                        <Download className="mr-1.5 h-4 w-4" /> Fallidos (CSV)
                      </Button>
                    </a>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex flex-wrap gap-1">
                  {TABS.map((t) => (
                    <Button
                      key={t.key}
                      size="sm"
                      variant={tab === t.key ? "secondary" : "ghost"}
                      onClick={() => setTab(t.key)}
                    >
                      {t.label}
                    </Button>
                  ))}
                </div>
                {recipients.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nadie en esta vista.</p>
                ) : (
                  <ul className="divide-y text-sm" data-testid="campaign-recipients">
                    {recipients.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.contactName}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatPhone(r.phone)}
                            {r.sentAt &&
                              ` · ${new Date(r.sentAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}`}
                          </p>
                          {r.errorMessage && <p className="text-xs text-danger-text">{r.errorMessage}</p>}
                          {r.delivery?.error && <p className="text-xs text-danger-text">{r.delivery.error}</p>}
                        </div>
                        {r.delivery ? (
                          <Badge variant={DELIVERY_BADGE[r.delivery.status]}>
                            {DELIVERY_STATUS_LABEL[r.delivery.status]}
                          </Badge>
                        ) : (
                          <Badge variant={RECIPIENT_BADGE[r.status]}>{RECIPIENT_STATUS_LABEL[r.status]}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {recipients.length >= 500 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Se muestran los primeros 500: descarga el CSV para verlos todos.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <p className={danger ? "text-xl font-bold text-danger-text" : "text-xl font-bold"}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
