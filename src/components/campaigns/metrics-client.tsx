"use client";

import { useEffect, useState } from "react";
import { Download, Info } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import {
  formatPct,
  syncLabel,
  type CampaignMetricsDto,
  type MetaSyncInfo,
} from "@/lib/campaign-metrics";
import { CAMPAIGN_STATUS_LABEL, RATE_CATEGORY_LABEL, type CampaignStatus } from "@/lib/campaigns";
import { PhoneHealthCard } from "@/components/number-health";
import { defaultRange, RangePicker, type Range } from "@/components/results/range-picker";
import { TimeBars } from "@/components/results/time-bars";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Campañas v2 (PR 3) — Pestaña Métricas. Todo sale de `GET
 * /api/campaigns/metrics` (base propia; nunca Meta en vivo). Costo por
 * campaña = "Estimado"; los totales lo ponen junto a lo "Reportado por Meta",
 * con la diferencia. Si Meta dice que las analíticas de plantillas no están
 * activas, se avisa y lo demás funciona igual.
 */

const nf = new Intl.NumberFormat("es-MX");

function money(v: number | null, currency: string | null): string {
  if (v === null) return "—";
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
    } catch {
      // moneda que el navegador no conoce: número y código
    }
  }
  return `${v.toLocaleString("es-MX", { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;
}

function Kpi({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-subtle px-3 py-2.5" data-testid={testId}>
      <p className="text-xs font-medium text-text-2">{label}</p>
      <p className="mt-0.5 truncate text-xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-text-3">{hint}</p>}
    </div>
  );
}

function SyncLine({ kind, info }: { kind: "template" | "pricing"; info: MetaSyncInfo }) {
  const tone =
    info.status === "ok" ? "text-text-3" : info.status === "never" ? "text-text-3" : "text-warning-text";
  return (
    <p className={`text-xs ${tone}`} data-testid={`sync-${kind}`} data-status={info.status}>
      {syncLabel(kind, info)}
      {info.syncedAt &&
        ` · última: ${new Date(info.syncedAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}`}
    </p>
  );
}

export function MetricsClient({ today, timezone }: { today: string; timezone: string }) {
  const [range, setRange] = useState<Range>(() => defaultRange(today));
  const [phone, setPhone] = useState("");
  const [data, setData] = useState<CampaignMetricsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = `from=${range.from}&to=${range.to}${phone ? `&phone=${encodeURIComponent(phone)}` : ""}`;

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    void fetchJson<CampaignMetricsDto>(`/api/campaigns/metrics?${query}`).then((res) => {
      if (!vivo) return;
      setLoading(false);
      if (res.ok) {
        setData(res.data);
        setError(null);
      } else setError(res.error);
    });
    return () => {
      vivo = false;
    };
  }, [query]);

  const t = data?.totals;
  const cur = data?.cost.estimatedCurrency ?? data?.cost.reportedCurrency ?? null;

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" data-testid="metrics-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker value={range} onChange={setRange} today={today} timezone={timezone} />
        <div className="flex items-center gap-2">
          {data && data.phoneOptions.length > 1 && (
            <select
              aria-label="Número"
              data-testid="metrics-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-8 rounded-md border border-input bg-card px-2 text-xs"
            >
              <option value="">Todos los números</option>
              {data.phoneOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          <a
            href={`/api/campaigns/metrics/export?${query}`}
            data-testid="metrics-export"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium text-text-2 hover:bg-accent hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" /> Exportar CSV
          </a>
        </div>
      </div>

      {error && <p className="text-sm text-danger-text">{error}</p>}
      {loading && !data && <p className="text-sm text-muted-foreground">Cargando métricas…</p>}

      {data && t && (
        <div className={loading ? "space-y-4 opacity-60 transition-opacity" : "space-y-4"}>
          <section aria-label="Indicadores" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <Kpi testId="kpi-sent" label="Enviados" value={nf.format(t.sent)} hint="aceptados por Meta" />
            <Kpi testId="kpi-delivered" label="Entregados" value={formatPct(t.delivered, t.sent)} hint={`${nf.format(t.delivered)} de ${nf.format(t.sent)}`} />
            <Kpi testId="kpi-read" label="Leídos" value={formatPct(t.read, t.sent)} hint={`${nf.format(t.read)} de ${nf.format(t.sent)}`} />
            <Kpi
              testId="kpi-replied"
              label="Respondieron"
              value={formatPct(t.replied, t.sent)}
              hint={`${nf.format(t.replied)} en ${data.replyWindowHours} h`}
            />
            <Kpi testId="kpi-failed" label="Fallidos" value={nf.format(t.failed)} />
            <Kpi testId="kpi-optouts" label="Bajas" value={nf.format(t.optOuts)} hint="tras recibirla" />
            <Kpi testId="kpi-cost" label="Costo" value={money(data.cost.estimated, cur)} hint="Estimado" />
          </section>

          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <Card>
              <CardContent className="pt-5">
                <TimeBars
                  title={data.period.granularity === "month" ? "Enviados por mes" : "Enviados por día"}
                  unit="enviados"
                  format={(v) => nf.format(v)}
                  points={data.series.map((s) => ({
                    bucket: s.bucket,
                    value: s.sent,
                    detail: `${nf.format(s.delivered)} entregados · ${nf.format(s.read)} leídos · ${nf.format(s.replied)} respondieron · ${nf.format(s.failed)} fallidos`,
                  }))}
                  emptyText="Sin envíos de campañas en el periodo."
                />
              </CardContent>
            </Card>
            <Card data-testid="failure-reasons">
              <CardHeader>
                <CardTitle className="text-sm">Fallidos por motivo</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {data.failureReasons.length === 0 && <p className="text-text-3">Sin fallos en el periodo.</p>}
                {data.failureReasons.map((f) => (
                  <div key={`${f.code}-${f.reason}`} className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-text-2">{f.reason}</span>
                    <span className="shrink-0 font-medium">{nf.format(f.count)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card data-testid="cost-reconciliation">
            <CardHeader>
              <CardTitle className="text-sm">Costo del periodo</CardTitle>
              <CardDescription>
                El estimado sale de tus tarifas (Ajustes de envío) y solo cubre campañas. Lo reportado por Meta incluye
                todos los mensajes cobrados del número y se corta por días UTC.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Estimado</dt>
                  <dd className="text-lg font-semibold" data-testid="cost-estimated">
                    {money(data.cost.estimated, data.cost.estimatedCurrency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Reportado por Meta</dt>
                  <dd className="text-lg font-semibold" data-testid="cost-reported">
                    {money(data.cost.reported, data.cost.reportedCurrency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Diferencia (Meta − estimado)</dt>
                  <dd className="text-lg font-semibold" data-testid="cost-difference">
                    {data.cost.difference === null
                      ? "—"
                      : `${data.cost.difference > 0 ? "+" : ""}${money(data.cost.difference, data.cost.reportedCurrency ?? data.cost.estimatedCurrency)}`}
                  </dd>
                </div>
              </dl>
              {data.cost.differenceNote && (
                <p className="flex items-center gap-1.5 text-xs text-text-3">
                  <Info className="h-3.5 w-3.5 shrink-0" /> {data.cost.differenceNote}
                </p>
              )}
              {data.cost.byCategory.length > 0 && (
                <table className="w-full text-xs">
                  <thead className="text-left text-text-3">
                    <tr>
                      <th className="py-1 font-medium">Categoría (Meta)</th>
                      <th className="py-1 text-right font-medium">Mensajes</th>
                      <th className="py-1 text-right font-medium">Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cost.byCategory.map((c) => (
                      <tr key={c.category} className="border-t">
                        <td className="py-1">{RATE_CATEGORY_LABEL[c.category.toLowerCase()] ?? c.category}</td>
                        <td className="py-1 text-right">{nf.format(c.volume)}</td>
                        <td className="py-1 text-right">{money(c.cost, data.cost.reportedCurrency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <SyncLine kind="pricing" info={data.sync.pricing} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Campañas del periodo</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.campaigns.length === 0 ? (
                <p className="text-sm text-text-3">Ninguna campaña envió en este periodo.</p>
              ) : (
                <table className="w-full min-w-[720px] text-sm" data-testid="metrics-campaigns">
                  <thead className="text-left text-xs text-text-3">
                    <tr>
                      <th className="py-1.5 font-medium">Campaña</th>
                      <th className="py-1.5 text-right font-medium">Enviados</th>
                      <th className="py-1.5 text-right font-medium">Entregados</th>
                      <th className="py-1.5 text-right font-medium">Leídos</th>
                      <th className="py-1.5 text-right font-medium">Respondieron</th>
                      <th className="py-1.5 text-right font-medium">Fallidos</th>
                      <th className="py-1.5 text-right font-medium">Bajas</th>
                      <th className="py-1.5 text-right font-medium">Costo estimado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns.map((c) => (
                      <tr key={c.id} className="border-t">
                        <td className="py-1.5">
                          <a href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                            {c.name}
                          </a>
                          <span className="ml-2 text-xs text-text-3">
                            {c.startedAt ? new Date(c.startedAt).toLocaleDateString("es-MX", { dateStyle: "medium" }) : ""}
                            {" · "}
                            {CAMPAIGN_STATUS_LABEL[c.status as CampaignStatus] ?? c.status}
                          </span>
                        </td>
                        <td className="py-1.5 text-right">{nf.format(c.sent)}</td>
                        <td className="py-1.5 text-right">{formatPct(c.delivered, c.sent)}</td>
                        <td className="py-1.5 text-right">{formatPct(c.read, c.sent)}</td>
                        <td className="py-1.5 text-right">{formatPct(c.replied, c.sent)}</td>
                        <td className="py-1.5 text-right">{nf.format(c.failed)}</td>
                        <td className="py-1.5 text-right">{nf.format(c.optOuts)}</td>
                        <td className="py-1.5 text-right">
                          {money(c.estimatedCost, data.cost.estimatedCurrency)}{" "}
                          {c.estimatedCost !== null && <Badge variant="secondary">Estimado</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card data-testid="template-analytics">
            <CardHeader>
              <CardTitle className="text-sm">Plantillas según Meta</CardTitle>
              <CardDescription>Lo que Meta reporta por plantilla (incluye envíos fuera de campañas).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 overflow-x-auto text-sm">
              {data.sync.template.status === "not_enabled" && (
                <p className="rounded-md border border-warning-soft bg-warning-tint p-3 text-warning-text" data-testid="template-analytics-disabled">
                  Meta respondió que las analíticas de plantillas no están activas en tu cuenta de WhatsApp Business.
                  Actívalas en el Administrador de WhatsApp (Información → Analíticas de plantillas); el resto de las
                  métricas funciona igual.
                </p>
              )}
              {data.templates.length === 0 && data.sync.template.status !== "not_enabled" && (
                <p className="text-text-3">Sin datos de Meta para este periodo.</p>
              )}
              {data.templates.length > 0 && (
                <table className="w-full min-w-[480px]">
                  <thead className="text-left text-xs text-text-3">
                    <tr>
                      <th className="py-1 font-medium">Plantilla</th>
                      <th className="py-1 text-right font-medium">Enviados</th>
                      <th className="py-1 text-right font-medium">Entregados</th>
                      <th className="py-1 text-right font-medium">Leídos</th>
                      <th className="py-1 text-right font-medium">Clics</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.templates.map((tp) => (
                      <tr key={tp.waTemplateId} className="border-t">
                        <td className="py-1">{tp.name ?? tp.waTemplateId}</td>
                        <td className="py-1 text-right">{nf.format(tp.sent)}</td>
                        <td className="py-1 text-right">{formatPct(tp.delivered, tp.sent)}</td>
                        <td className="py-1 text-right">{formatPct(tp.read, tp.sent)}</td>
                        <td className="py-1 text-right">{nf.format(tp.clicked)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <SyncLine kind="template" info={data.sync.template} />
            </CardContent>
          </Card>

          <PhoneHealthCard />
        </div>
      )}
    </div>
  );
}
