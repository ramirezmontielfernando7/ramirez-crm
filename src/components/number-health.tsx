"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import {
  messagingLimitLabel,
  QUALITY_LABEL,
  type HealthAlert,
  type PhoneHealthSnapshot,
} from "@/lib/phone-health";
import { useViewer } from "@/components/viewer-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Campañas v2 (PR 1) — Salud del número de WhatsApp: la tarjeta (con
 * "Actualizar") y el aviso global para Propietario y Coordinador. Todo sale
 * de la base propia (`GET /api/number-health`); solo "Actualizar" consulta a
 * Meta, a lo más una vez por minuto.
 */

export type HealthSummaryDto = {
  connected: boolean;
  phoneNumberId: string | null;
  today: PhoneHealthSnapshot | null;
  previous: PhoneHealthSnapshot | null;
  history: PhoneHealthSnapshot[];
  usage: number;
  usageAlertPercent: number;
  alerts: HealthAlert[];
};

const QUALITY_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  GREEN: "success",
  YELLOW: "warning",
  RED: "destructive",
};

export function PhoneHealthCard() {
  const [summary, setSummary] = useState<HealthSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetchJson<HealthSummaryDto>("/api/number-health");
    if (res.ok) setSummary(res.data);
    else setError(res.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setBusy(true);
    setError(null);
    const res = await fetchJson<HealthSummaryDto>("/api/number-health", { method: "POST" });
    setBusy(false);
    if (res.ok) setSummary(res.data);
    else setError(res.error);
  }

  const today = summary?.today ?? null;
  const limit = today?.messagingLimitValue ?? null;
  return (
    <Card className="max-w-3xl" data-testid="phone-health-card">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Salud del número</CardTitle>
          <CardDescription>
            Lo que Meta reporta de tu número: calidad, límite de destinatarios en 24 h y estado. Se lee una vez al
            día; «Actualizar» lo consulta ahora.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" disabled={busy || summary?.connected === false} onClick={() => void refresh()}>
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Actualizar
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {summary && !summary.connected && <p className="text-muted-foreground">Conecta tu número de WhatsApp para ver su salud.</p>}
        {summary?.connected && !today && (
          <p className="text-muted-foreground">Todavía no hay lectura de hoy. Pulsa «Actualizar».</p>
        )}
        {today && (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Calidad</dt>
              <dd>
                <Badge variant={QUALITY_VARIANT[today.qualityRating ?? ""] ?? "secondary"} data-testid="health-quality">
                  {QUALITY_LABEL[today.qualityRating ?? ""] ?? today.qualityRating ?? "Sin dato"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Límite</dt>
              <dd data-testid="health-limit">{messagingLimitLabel(today.messagingLimit)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Uso (24 h, estimado)</dt>
              <dd data-testid="health-usage">
                {summary!.usage.toLocaleString("es-MX")}
                {limit ? ` de ${limit.toLocaleString("es-MX")}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Estado</dt>
              <dd>{today.status ?? "Sin dato"}</dd>
            </div>
          </dl>
        )}
        {today && (
          <p className="text-xs text-muted-foreground">
            Última lectura: {new Date(today.fetchedAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
            {today.throughputLevel ? ` · rendimiento ${today.throughputLevel}` : ""}
          </p>
        )}
        {summary?.alerts.map((a) => (
          <p key={a.code} className={a.level === "danger" ? "text-danger-text" : "text-warning-text"}>
            {a.message}
          </p>
        ))}
        {error && <p className="text-danger-text">{error}</p>}
      </CardContent>
    </Card>
  );
}

const BANNER_REFRESH_MS = 15 * 60 * 1000;

/** Aviso en la parte de arriba de la app cuando la salud del número lo amerita. */
export function NumberHealthBanner({ campaigns }: { campaigns: boolean }) {
  const viewer = useViewer();
  const allowed = viewer.can("number_health.read");
  const [alerts, setAlerts] = useState<HealthAlert[]>([]);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    const load = async () => {
      const res = await fetchJson<HealthSummaryDto>("/api/number-health");
      // Sin datos el aviso simplemente no aparece; la tarjeta muestra el error.
      if (alive && res.ok) setAlerts(res.data.alerts);
    };
    void load();
    const t = setInterval(() => void load(), BANNER_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [allowed]);

  const key = alerts.map((a) => a.code).join(",");
  if (!allowed || alerts.length === 0 || dismissed === key) return null;
  const worst = alerts.find((a) => a.level === "danger") ?? alerts[0]!;
  const href = campaigns ? "/campaigns" : viewer.can("settings.manage") ? "/settings/whatsapp" : null;
  return (
    <div
      role="alert"
      data-testid="number-health-banner"
      className={`flex shrink-0 items-start gap-2 border-b px-4 py-2 text-sm ${
        worst.level === "danger" ? "border-danger-soft bg-danger-tint" : "border-warning-soft bg-warning-tint"
      }`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Salud del número: </span>
        {worst.message}
        {alerts.length > 1 && ` (+${alerts.length - 1} aviso${alerts.length > 2 ? "s" : ""})`}
        {href && (
          <>
            {" "}
            <Link href={href} className="underline underline-offset-2">
              Ver detalle
            </Link>
          </>
        )}
      </p>
      <button
        type="button"
        aria-label="Ocultar aviso"
        className="rounded p-0.5 hover:bg-black/5"
        onClick={() => setDismissed(key)}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
