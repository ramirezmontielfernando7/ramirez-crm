"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  COST_KIND_LABEL,
  ESTIMATE_NOTE,
  formatLocal,
  formatUsd,
  type CostReport,
  type OrgCostLine,
  type Pricing,
} from "@/lib/costs";
import { formatTokens } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { api, fecha, mesDe } from "./api";

/**
 * 036 (PR 3b) — Plataforma → Costos. Arriba, el mes (estimado, real y
 * proyección) en USD y en la moneda local; luego cada organización con su
 * desglose por función; abajo, los precios con su historial «vigente desde».
 * Solo números, nunca contenido de un negocio.
 */

/** Un monto en USD y, debajo, en la moneda local. */
function Money({ usd, pricing, testId, strong }: { usd: number | null; pricing: Pricing | null; testId?: string; strong?: boolean }) {
  return (
    <span className="block min-w-0 tabular-nums" data-testid={testId} data-usd={usd ?? ""}>
      <span className={cn("block truncate", strong ? "text-[15px] font-semibold text-foreground" : "text-sm text-foreground")}>{formatUsd(usd)}</span>
      {pricing && usd !== null && <span className="block truncate text-xs text-text-3">{formatLocal(usd, pricing)}</span>}
    </span>
  );
}

function Tile({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border p-3">
      <p className="text-xs text-text-2">{label}</p>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-text-3">{hint}</p>}
    </div>
  );
}

function OrgRow({ row, pricing }: { row: OrgCostLine; pricing: Pricing | null }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2" data-testid={`platform-cost-org-${row.organizationId}`}>
      <button
        type="button"
        className="grid w-full grid-cols-2 items-start gap-x-3 gap-y-2 text-left sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_1rem]"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="col-span-2 min-w-0 sm:col-span-1">
          <span className="block truncate text-sm font-medium">{row.name}</span>
          {row.status !== "active" && <span className="text-xs text-text-3">{row.status === "suspended" ? "Suspendida" : "Borrada"}</span>}
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] text-text-3 sm:hidden">Estimado</span>
          <Money usd={row.estimatedUsd} pricing={pricing} testId="cost-estimated" />
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] text-text-3 sm:hidden">Real (OpenRouter)</span>
          <Money usd={row.realUsd} pricing={pricing} testId="cost-real" />
        </span>
        <span className="min-w-0">
          <span className="block text-[11px] text-text-3 sm:hidden">Proyección del mes</span>
          <Money usd={row.projectedUsd} pricing={pricing} testId="cost-projected" />
        </span>
        {open ? (
          <ChevronUp className="hidden h-4 w-4 text-text-3 sm:block" aria-hidden />
        ) : (
          <ChevronDown className="hidden h-4 w-4 text-text-3 sm:block" aria-hidden />
        )}
      </button>
      {open && (
        <ul className="mt-2 divide-y rounded-md bg-muted/40 px-3 text-sm" data-testid="platform-cost-kinds">
          {row.byKind.map((k) => (
            <li key={k.kind} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
              <span className="min-w-0">
                {COST_KIND_LABEL[k.kind]} <span className="text-xs text-text-3">· {formatTokens(k.tokens)} tokens</span>
              </span>
              <span className="tabular-nums text-text-2">
                {formatUsd(k.estimatedUsd)} est. · {k.realUsd > 0 ? `${formatUsd(k.realUsd)} real` : "sin reporte"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

type Draft = Record<
  "chatIn" | "chatOut" | "judgeIn" | "judgeOut" | "embed" | "rate" | "currency" | "validFrom",
  string
>;

const hoy = () => new Date().toISOString().slice(0, 10);

function draftFrom(p: Pricing | null): Draft {
  const s = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  return {
    chatIn: s(p?.chatInputUsdPerMtok),
    chatOut: s(p?.chatOutputUsdPerMtok),
    judgeIn: s(p?.judgeInputUsdPerMtok),
    judgeOut: s(p?.judgeOutputUsdPerMtok),
    embed: s(p?.embedUsdPerMtok ?? 0),
    rate: s(p?.usdToLocal),
    currency: p?.localCurrency ?? "MXN",
    validFrom: hoy(),
  };
}

const FIELDS: { key: keyof Draft; label: string; hint?: string; optional?: boolean }[] = [
  { key: "chatIn", label: "Modelo principal: entrada" },
  { key: "chatOut", label: "Modelo principal: salida" },
  { key: "judgeIn", label: "Juez: entrada", hint: "Vacío = igual que el principal", optional: true },
  { key: "judgeOut", label: "Juez: salida", hint: "Vacío = igual que el principal", optional: true },
  { key: "embed", label: "Embeddings", hint: "0 si usas el contenedor local" },
];

function PricingForm({ current, history, onSaved }: { current: Pricing | null; history: Pricing[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(draftFrom(current)), [current]);

  async function save() {
    const n = (v: string) => Number(v.trim().replace(",", "."));
    const req = (k: keyof Draft, label: string) => {
      const v = n(draft[k]);
      if (draft[k].trim() === "" || !Number.isFinite(v) || v < 0) throw new Error(`«${label}»: escribe un número mayor o igual a 0`);
      return v;
    };
    const opt = (k: keyof Draft, label: string) => (draft[k].trim() === "" ? null : req(k, label));
    let body;
    try {
      const rate = req("rate", "Tipo de cambio");
      if (rate <= 0) throw new Error("«Tipo de cambio»: debe ser mayor que 0");
      body = {
        chatInputUsdPerMtok: req("chatIn", "Modelo principal: entrada"),
        chatOutputUsdPerMtok: req("chatOut", "Modelo principal: salida"),
        judgeInputUsdPerMtok: opt("judgeIn", "Juez: entrada"),
        judgeOutputUsdPerMtok: opt("judgeOut", "Juez: salida"),
        embedUsdPerMtok: req("embed", "Embeddings"),
        usdToLocal: rate,
        localCurrency: draft.currency.trim().toUpperCase(),
        ...(draft.validFrom ? { validFrom: draft.validFrom } : {}),
      };
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await api<{ pricing: Pricing }>("/api/platform/pricing", { method: "POST", body: JSON.stringify(body) });
    setBusy(false);
    if (!r.data) {
      setError(r.error);
      return;
    }
    setSaved(true);
    onSaved();
  }

  return (
    <Card data-testid="platform-pricing">
      <CardHeader>
        <CardTitle>Precios de IA y tipo de cambio</CardTitle>
        <CardDescription>
          USD por millón de tokens, como los publica OpenRouter para tus modelos. Guardar crea un precio nuevo «vigente desde» la
          fecha: los anteriores quedan en el historial y los meses cerrados se siguen estimando con el suyo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="min-w-0 space-y-1">
              <Label htmlFor={`price-${f.key}`} className="text-xs">
                {f.label} <span className="text-text-3">(USD / M tokens)</span>
              </Label>
              <Input
                id={`price-${f.key}`}
                inputMode="decimal"
                className="h-8"
                value={draft[f.key]}
                placeholder={f.optional ? "Igual que el principal" : ""}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                data-testid={`platform-price-${f.key}`}
              />
              {f.hint && <p className="text-[11px] text-text-3">{f.hint}</p>}
            </div>
          ))}
          <div className="min-w-0 space-y-1">
            <Label htmlFor="price-rate" className="text-xs">
              Tipo de cambio <span className="text-text-3">(1 USD =)</span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="price-rate"
                inputMode="decimal"
                className="h-8 min-w-0"
                value={draft.rate}
                onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
                data-testid="platform-price-rate"
              />
              <Input
                aria-label="Moneda local"
                className="h-8 w-20 uppercase"
                maxLength={3}
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                data-testid="platform-price-currency"
              />
            </div>
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="price-from" className="text-xs">
              Vigente desde <span className="text-text-3">(UTC)</span>
            </Label>
            <Input
              id="price-from"
              type="date"
              className="h-8"
              value={draft.validFrom}
              onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })}
              data-testid="platform-price-validFrom"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => void save()} data-testid="platform-pricing-save">
            {busy ? "Guardando…" : "Guardar precios"}
          </Button>
          {saved && (
            <span className="text-xs text-text-2" data-testid="platform-pricing-saved">
              Guardado
            </span>
          )}
        </div>
        {error && (
          <p className="text-sm text-destructive" data-testid="platform-pricing-error">
            {error}
          </p>
        )}

        <div>
          <p className="text-xs font-medium text-text-2">Historial</p>
          {history.length === 0 ? (
            <p className="text-sm text-text-3">Aún no hay precios: el estimado aparece al guardar el primero.</p>
          ) : (
            <ul className="divide-y text-sm" data-testid="platform-pricing-history">
              {history.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
                  <span className="min-w-0">
                    Desde {new Date(p.validFrom).toLocaleDateString("es-MX", { dateStyle: "medium", timeZone: "UTC" })}
                    {current?.id === p.id && <span className="ml-1.5 rounded-sm bg-brand/10 px-1 text-xs text-brand">vigente</span>}
                    <span className="block text-xs text-text-3">
                      {p.createdByEmail ?? "—"} · {fecha(p.createdAt)}
                    </span>
                  </span>
                  <span className="tabular-nums text-xs text-text-2">
                    {p.chatInputUsdPerMtok} / {p.chatOutputUsdPerMtok}
                    {p.judgeInputUsdPerMtok !== null || p.judgeOutputUsdPerMtok !== null
                      ? ` · juez ${p.judgeInputUsdPerMtok ?? p.chatInputUsdPerMtok} / ${p.judgeOutputUsdPerMtok ?? p.chatOutputUsdPerMtok}`
                      : ""}
                    {` · emb ${p.embedUsdPerMtok} · 1 USD = ${p.usdToLocal} ${p.localCurrency}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function CostsClient() {
  const [report, setReport] = useState<CostReport | null>(null);
  const [history, setHistory] = useState<Pricing[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r, h] = await Promise.all([
      api<{ report: CostReport }>("/api/platform/costs"),
      api<{ pricing: Pricing[] }>("/api/platform/pricing"),
    ]);
    if (r.data) setReport(r.data.report);
    else setError(r.error);
    if (h.data) setHistory(h.data.pricing);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!report) return <p className="text-sm text-text-2">{error ?? "Cargando costos…"}</p>;
  const { pricing, totals } = report;
  const pct = Math.round(report.elapsed * 100);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Card data-testid="platform-costs">
        <CardHeader>
          <CardTitle>Costo de IA · {mesDe(report.period)}</CardTitle>
          <CardDescription>
            Mes en UTC, va el {pct} %.{" "}
            {pricing
              ? `Moneda local con 1 USD = ${pricing.usdToLocal} ${pricing.localCurrency}.`
              : "Captura los precios abajo para ver el estimado y la moneda local."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile label="Estimado (tus precios)">
              <Money usd={totals.estimatedUsd} pricing={pricing} testId="platform-cost-total-estimated" strong />
            </Tile>
            <Tile label="Real (OpenRouter)" hint={totals.realUsd === null ? "Sin reportes todavía" : undefined}>
              <Money usd={totals.realUsd} pricing={pricing} testId="platform-cost-total-real" strong />
            </Tile>
            <Tile label="Proyección a fin de mes" hint="El mayor entre estimado y real, al ritmo del mes">
              <Money usd={totals.projectedUsd} pricing={pricing} testId="platform-cost-total-projected" strong />
            </Tile>
          </div>
          <p className="text-xs text-text-3">{ESTIMATE_NOTE}</p>

          <div>
            <div className="hidden grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_1rem] gap-x-3 border-b pb-1 text-xs text-text-3 sm:grid">
              <span>Organización</span>
              <span>Estimado</span>
              <span>Real (OpenRouter)</span>
              <span>Proyección del mes</span>
              <span />
            </div>
            {report.rows.length === 0 ? (
              <p className="py-3 text-sm text-text-3">Ninguna organización ha usado IA este mes.</p>
            ) : (
              <ul className="divide-y" data-testid="platform-cost-rows">
                {report.rows.map((row) => (
                  <OrgRow key={row.organizationId} row={row} pricing={pricing} />
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      <PricingForm current={pricing} history={history} onSaved={() => void load()} />
    </div>
  );
}
