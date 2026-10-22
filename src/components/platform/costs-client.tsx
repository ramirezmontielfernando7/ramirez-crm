"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AI_ROLE_ENV,
  AI_ROLE_LABEL,
  capacityCost,
  COST_KIND_LABEL,
  ESTIMATE_NOTE,
  formatLocal,
  formatUsd,
  hasExchangeRate,
  type AiRole,
  type CapacityLine,
  type CostReport,
  type OrgCostLine,
  type Pricing,
  type PriceSuggestion,
} from "@/lib/costs";
import type { ModelsInUse } from "@/server/costs/models";
import type { ProbeResult } from "@/lib/ai/probe";
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
      {hasExchangeRate(pricing) && usd !== null && <span className="block truncate text-xs text-text-3">{formatLocal(usd, pricing)}</span>}
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
  "chatIn" | "chatOut" | "judgeIn" | "judgeOut" | "anaIn" | "anaOut" | "embed" | "rate" | "currency" | "validFrom",
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
    anaIn: s(p?.analysisInputUsdPerMtok),
    anaOut: s(p?.analysisOutputUsdPerMtok),
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
  { key: "anaIn", label: "Análisis: entrada", hint: "Modelo OPENROUTER_ANALYSIS_MODEL. Vacío = igual que el principal", optional: true },
  { key: "anaOut", label: "Análisis: salida", hint: "Vacío = igual que el principal", optional: true },
  { key: "embed", label: "Embeddings", hint: "0 si usas el contenedor local" },
];

function PricingForm({
  current,
  history,
  models,
  onSaved,
}: {
  current: Pricing | null;
  history: Pricing[];
  models: ModelsInUse | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(draftFrom(current)), [current]);

  const [note, setNote] = useState<string | null>(null);

  /** Rellena el borrador (sin guardar) con precios por función. */
  function fill(by: Partial<Record<AiRole, PriceSuggestion | null>>, fromWhere: string) {
    const f = (x: number | undefined) => (x === undefined ? undefined : String(x));
    const main = by.main;
    const judge = by.judge;
    const ana = by.analysis;
    setDraft((d) => ({
      ...d,
      ...(main ? { chatIn: f(main.inputUsdPerMtok)!, chatOut: f(main.outputUsdPerMtok)! } : {}),
      // Si el juez/análisis usa otro modelo, su precio; si cae al principal, vacío (= igual).
      ...(models?.models.find((m) => m.role === "judge")?.source === "own" && judge
        ? { judgeIn: f(judge.inputUsdPerMtok)!, judgeOut: f(judge.outputUsdPerMtok)! }
        : {}),
      ...(models?.models.find((m) => m.role === "analysis")?.source === "own" && ana
        ? { anaIn: f(ana.inputUsdPerMtok)!, anaOut: f(ana.outputUsdPerMtok)! }
        : {}),
    }));
    const missing = (["main", "judge", "analysis"] as const).filter(
      (r) => models?.models.find((m) => m.role === r)?.model && !by[r]
    );
    setNote(
      `Precios rellenados desde ${fromWhere}. Revísalos y pulsa «Guardar precios».` +
        (missing.length ? ` Sin precio para: ${missing.map((r) => AI_ROLE_LABEL[r].split(" (")[0]).join(", ")} (captúralo a mano).` : "")
    );
  }

  async function fromOpenRouter() {
    setBusy(true);
    setError(null);
    const r = await api<{ prices: Partial<Record<AiRole, PriceSuggestion | null>> }>("/api/platform/pricing/openrouter", { method: "POST" });
    setBusy(false);
    if (!r.data) return setError(r.error);
    fill(r.data.prices, "OpenRouter");
  }

  function fromKnown() {
    const by: Partial<Record<AiRole, PriceSuggestion | null>> = {};
    for (const m of models?.models ?? []) by[m.role] = m.suggestion;
    if (!by.main && !by.judge && !by.analysis) {
      setError("Ninguno de tus modelos está en la lista de precios conocidos: captúralos a mano.");
      return;
    }
    setError(null);
    fill(by, "la lista de precios conocidos (confírmalos contra tu factura)");
  }

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
      // El tipo de cambio es opcional: vacío = todo se ve solo en USD.
      const rate = draft.rate.trim() === "" ? null : req("rate", "Tipo de cambio");
      if (rate !== null && rate <= 0) throw new Error("«Tipo de cambio»: debe ser mayor que 0");
      body = {
        chatInputUsdPerMtok: req("chatIn", "Modelo principal: entrada"),
        chatOutputUsdPerMtok: req("chatOut", "Modelo principal: salida"),
        judgeInputUsdPerMtok: opt("judgeIn", "Juez: entrada"),
        judgeOutputUsdPerMtok: opt("judgeOut", "Juez: salida"),
        analysisInputUsdPerMtok: opt("anaIn", "Análisis: entrada"),
        analysisOutputUsdPerMtok: opt("anaOut", "Análisis: salida"),
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
          USD por millón de tokens, como los publica tu proveedor. El tipo de cambio es opcional: sin él todo se ve solo en USD. Guardar crea un precio nuevo «vigente desde» la
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
              Tipo de cambio <span className="text-text-3">(1 USD =, opcional)</span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="price-rate"
                inputMode="decimal"
                className="h-8 min-w-0"
                value={draft.rate}
                placeholder="Vacío = solo USD"
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
          {models?.pricesByApi ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void fromOpenRouter()} data-testid="platform-pricing-openrouter">
              Traer precios de OpenRouter
            </Button>
          ) : (
            <span className="text-xs text-text-3">Este proveedor no publica precios por API: captúralos a mano.</span>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={fromKnown} data-testid="platform-pricing-known">
            Usar precios conocidos
          </Button>
        </div>
        {note && (
          <p className="text-xs text-text-2" data-testid="platform-pricing-note">
            {note}
          </p>
        )}
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
                    {p.analysisInputUsdPerMtok !== null || p.analysisOutputUsdPerMtok !== null
                      ? ` · análisis ${p.analysisInputUsdPerMtok ?? p.chatInputUsdPerMtok} / ${p.analysisOutputUsdPerMtok ?? p.chatOutputUsdPerMtok}`
                      : ""}
                    {` · emb ${p.embedUsdPerMtok}`}
                    {p.usdToLocal !== null ? ` · 1 USD = ${p.usdToLocal} ${p.localCurrency}` : " · solo USD"}
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

const SOURCE_TEXT: Record<"own" | "fallback" | "none", string> = {
  own: "variable propia",
  fallback: "usa el modelo principal",
  none: "sin configurar",
};

function ModelsCard({ models }: { models: ModelsInUse | null }) {
  const [results, setResults] = useState<Partial<Record<AiRole, ProbeResult | "running">>>({});

  async function probe(role: AiRole) {
    setResults((r) => ({ ...r, [role]: "running" }));
    const r = await api<{ result: ProbeResult }>("/api/platform/ai-models/test", { method: "POST", body: JSON.stringify({ role }) });
    setResults((x) => ({
      ...x,
      [role]: r.data?.result ?? { role, ok: false, model: null, latencyMs: 0, detail: r.error ?? "Error" },
    }));
  }

  if (!models) return null;
  return (
    <Card data-testid="platform-models">
      <CardHeader>
        <CardTitle>Modelos en uso</CardTitle>
        <CardDescription>
          Lo que lee el CRM de sus variables de entorno
          {models.providerHost ? ` · proveedor ${models.providerHost}` : ""}
          {models.hasToken ? " · llave configurada" : " · SIN llave"}. Nunca se muestran llaves. «Probar» hace una llamada mínima (unos pocos
          tokens, sin contar en la cuota de ninguna organización) y dice si el proveedor reconoció el modelo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => models.models.filter((m) => m.model).forEach((m) => void probe(m.role))}
          data-testid="platform-models-test-all"
        >
          Probar todos
        </Button>
        <ul className="divide-y text-sm">
          {models.models.map((m) => {
            const r = results[m.role];
            return (
              <li key={m.role} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2" data-testid={`platform-model-${m.role}`}>
                <span className="min-w-0">
                  <span className="block">{AI_ROLE_LABEL[m.role]}</span>
                  <span className="block truncate text-xs text-text-3">
                    <code>{m.model ?? "—"}</code> · {SOURCE_TEXT[m.source]} ({AI_ROLE_ENV[m.role]})
                  </span>
                  {r && r !== "running" && (
                    <span className={cn("block text-xs", r.ok ? "text-text-2" : "text-destructive")} data-testid={`platform-model-${m.role}-result`}>
                      {r.ok ? "OK" : "Error"} · {r.latencyMs} ms{r.detail ? ` · ${r.detail}` : ""}
                    </span>
                  )}
                </span>
                <Button size="sm" variant="outline" disabled={!m.model || r === "running"} onClick={() => void probe(m.role)}>
                  {r === "running" ? "Probando…" : "Probar conexión"}
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function CapacityCard({ pricing }: { pricing: Pricing | null }) {
  const [orgs, setOrgs] = useState<CapacityLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState("80");

  useEffect(() => {
    void (async () => {
      const r = await api<{ organizations: CapacityLine[] }>("/api/platform/costs/capacity");
      if (r.data) setOrgs(r.data.organizations);
      else setError(r.error);
    })();
  }, []);

  const pct = Number(share.replace(",", "."));
  const inputShare = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) / 100 : 0.8;
  const rows = pricing && orgs ? orgs.map((o) => ({ o, c: capacityCost(o.limits, pricing, inputShare) })) : [];
  const sum = rows.reduce((n, r) => n + (r.c.totalUsd ?? 0), 0);
  const anyUnbounded = rows.some((r) => r.c.unbounded);
  const tk = (n: number | null) => (n === null ? "sin tope" : formatTokens(n));

  return (
    <Card data-testid="platform-capacity">
      <CardHeader>
        <CardTitle>¿Cuánto me costaría cada cliente?</CardTitle>
        <CardDescription>
          Costo máximo del mes si cada organización gastara TODO su tope, con los precios vigentes. Peor caso: el asistente se cobra al más
          caro entre principal y análisis, el resto al más caro entre principal y juez. Los turnos no cambian el costo (el tope de tokens
          manda).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-w-xs space-y-1">
          <Label htmlFor="cap-share" className="text-xs">
            Proporción de tokens de ENTRADA <span className="text-text-3">(%; el resto es salida)</span>
          </Label>
          <Input id="cap-share" inputMode="decimal" className="h-8" value={share} onChange={(e) => setShare(e.target.value)} data-testid="platform-capacity-share" />
          <p className="text-[11px] text-text-3">Un chat suele ser mucha entrada (historial, prompt) y poca salida; 80 % es un punto de partida razonable.</p>
        </div>
        {!pricing ? (
          <p className="text-sm text-text-3">Captura los precios abajo para calcular.</p>
        ) : !orgs ? (
          <p className="text-sm text-text-2">{error ?? "Cargando topes…"}</p>
        ) : orgs.length === 0 ? (
          <p className="text-sm text-text-3">No hay organizaciones.</p>
        ) : (
          <>
            <ul className="divide-y" data-testid="platform-capacity-rows">
              {rows.map(({ o, c }) => (
                <li key={o.organizationId} className="grid grid-cols-2 items-start gap-x-3 gap-y-1 py-2 text-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1fr)]" data-testid={`platform-capacity-${o.organizationId}`}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{o.name}</span>
                    {o.status !== "active" && <span className="text-xs text-text-3">Suspendida</span>}
                  </span>
                  <span className="col-span-2 order-last text-xs text-text-3 sm:order-none sm:col-span-1">
                    IA {tk(o.limits.aiTokens)} · asistente {o.limits.assistantTokens === null ? "no responde" : formatTokens(o.limits.assistantTokens)} · embeddings{" "}
                    {tk(o.limits.embedTokens)} · {o.limits.aiTurns === null ? "turnos sin tope" : `${o.limits.aiTurns} turnos`}
                  </span>
                  <span className="min-w-0 text-right" data-testid="capacity-total" data-usd={c.totalUsd ?? ""}>
                    {c.totalUsd === null ? (
                      <span className="text-xs text-text-2">Sin techo (sin tope de tokens)</span>
                    ) : (
                      <Money usd={c.totalUsd} pricing={pricing} />
                    )}
                    {c.unbounded && c.totalUsd !== null && <span className="block text-[11px] text-text-3">Embeddings sin tope</span>}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between gap-3 border-t pt-2 text-sm font-medium">
              <span>Total si todos gastaran su tope</span>
              <span data-testid="platform-capacity-total" data-usd={sum}>
                {formatUsd(sum)}
                {hasExchangeRate(pricing) ? ` · ${formatLocal(sum, pricing)}` : ""}
              </span>
            </div>
            {anyUnbounded && <p className="text-xs text-text-3">Algunas organizaciones no tienen tope: su costo real no tiene techo y el total solo suma lo que sí tiene tope.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function CostsClient() {
  const [report, setReport] = useState<CostReport | null>(null);
  const [history, setHistory] = useState<Pricing[]>([]);
  const [models, setModels] = useState<ModelsInUse | null>(null);
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
    void (async () => {
      const m = await api<{ models: ModelsInUse }>("/api/platform/ai-models");
      if (m.data) setModels(m.data.models);
    })();
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
            {!pricing
              ? "Captura los precios abajo para ver el estimado."
              : hasExchangeRate(pricing)
                ? `Moneda local con 1 USD = ${pricing.usdToLocal} ${pricing.localCurrency}.`
                : "Solo USD (sin tipo de cambio capturado)."}
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

      <ModelsCard models={models} />

      <CapacityCard pricing={pricing} />

      <PricingForm current={pricing} history={history} models={models} onSaved={() => void load()} />
    </div>
  );
}
