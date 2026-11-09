"use client";

import { useCallback, useEffect, useState } from "react";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AI_EFFORT_LABEL, AI_EFFORTS, type AiEffort, type AiFunction } from "@/lib/ai/choice";
import {
  creditsPace,
  formatMtok,
  formatUsd2,
  FUNCTION_PROFILE,
  functionCost,
  monthName,
  usdToMtok,
  type Price,
} from "@/lib/ai-plans";
import type { ProbeResult } from "@/lib/ai/probe";
import { cn } from "@/lib/utils";
import type { AiSettingsOverview, FunctionView } from "@/server/ai-settings/admin";
import { api } from "./api";

/**
 * 0070 — Plataforma → «IA: modelos y costos» (parte de arriba): créditos de
 * AWS contra el presupuesto, los «Modelos de Dashfort» (los de la instancia)
 * y los valores de cada plan. Lo que se elige aquí aplica a todas las
 * empresas salvo que su plan o su ficha digan otra cosa.
 */

const FUNCS: { fn: AiFunction; label: string; hint: string }[] = [
  { fn: "agent", label: "Agentes", hint: "Contestan a los clientes en cada etapa" },
  { fn: "creator", label: "Creador de agentes", hint: "Arma agentes y simula clientes" },
  { fn: "assistant", label: "Asistente", hint: "También revisa chats y audita agentes" },
];

const PLANS = [
  { scope: "esencial", label: "Esencial" },
  { scope: "pro", label: "Pro" },
  { scope: "ultra", label: "Ultra" },
] as const;

type Overview = AiSettingsOverview;
type Catalog = Overview["catalog"];

export const MODEL_KEY = { agent: "agentModel", creator: "creatorModel", assistant: "assistantModel" } as const;
export const EFFORT_KEY = { agent: "agentEffort", creator: "creatorEffort" } as const;

export function priceOf(catalog: Catalog, model: string | null | undefined): Price | null {
  if (!model) return null;
  return catalog.find((c) => c.id === model)?.price ?? null;
}

const selectCls = "h-9 w-full min-w-0 rounded-md border bg-background px-2.5 text-sm";

/** Selector de modelo: el catálogo, más el valor actual si no está en él; «vacío» = heredar. */
export function ModelSelect({
  value,
  onChange,
  catalog,
  inheritLabel,
  testId,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  catalog: Catalog;
  inheritLabel: string;
  testId?: string;
}) {
  const ids = catalog.map((c) => c.id);
  return (
    <select
      className={cn(selectCls, value === null && "text-text-2")}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      data-testid={testId}
    >
      <option value="">{inheritLabel}</option>
      {catalog.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
      {value && !ids.includes(value) && <option value={value}>{value}</option>}
    </select>
  );
}

export function EffortSelect({
  value,
  onChange,
  inheritLabel,
  testId,
}: {
  value: AiEffort | null;
  onChange: (v: AiEffort | null) => void;
  inheritLabel: string;
  testId?: string;
}) {
  return (
    <select
      className={cn(selectCls, value === null && "text-text-2")}
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || null) as AiEffort | null)}
      data-testid={testId}
    >
      <option value="">{inheritLabel}</option>
      {AI_EFFORTS.map((e) => (
        <option key={e} value={e}>
          {AI_EFFORT_LABEL[e]}
        </option>
      ))}
    </select>
  );
}

export function AssistantModes() {
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {["Rápido · bajo", "Normal · medio", "Profundo · alto"].map((m) => (
        <span key={m} className="rounded-md bg-muted px-2 py-0.5 text-text-2">
          {m}
        </span>
      ))}
    </div>
  );
}

function costText(fn: AiFunction, price: Price | null): string {
  const c = functionCost(fn, price);
  if (c === null) return "sin precio";
  const unit = FUNCTION_PROFILE[fn].unit;
  return `${c < 0.1 ? c.toFixed(3) : c.toFixed(2)} USD / ${unit}`;
}

function viewLabel(v: FunctionView): string {
  return v.effort ? `${v.modelLabel} · ${AI_EFFORT_LABEL[v.effort].toLowerCase()}` : v.modelLabel;
}

/* ───────── Créditos ───────── */

function CreditsCard({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  const b = data.budget;
  const pace = creditsPace({
    budgetUsd: b.monthlyUsd,
    creditsUsd: b.creditsUsd,
    spentSinceCredits: b.spentSinceCredits,
    spentThisMonth: b.spentThisMonth,
    now: new Date(),
  });
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState(b.monthlyUsd?.toString() ?? "");
  const [credits, setCredits] = useState(b.creditsUsd?.toString() ?? "");
  const [since, setSince] = useState(b.creditsSince?.slice(0, 7) ?? "");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    const r = await api("/api/platform/ai-settings", {
      method: "PUT",
      body: JSON.stringify({
        kind: "defaults",
        scope: "instance",
        budgetMonthlyUsd: num(budget),
        creditsUsd: num(credits),
        creditsSince: since ? `${since}-01` : null,
      }),
    });
    if (!r.ok) return setError(r.error);
    setError(null);
    setEditing(false);
    onSaved();
  }

  const pct = pace.ratio === null ? null : Math.round(pace.ratio * 100);
  return (
    <Card data-testid="platform-ai-credits">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <CardTitle>Créditos de AWS</CardTitle>
          <CardDescription>
            {b.monthlyUsd && b.creditsUsd
              ? `Meta: ${formatUsd2(b.monthlyUsd)} al mes para que los ${formatUsd2(b.creditsUsd)} duren hasta ${monthName(pace.lastsUntil)}.`
              : "Captura tus créditos y un presupuesto mensual para ver cuánto te duran."}
          </CardDescription>
        </div>
        {pace.tone && (
          <Badge variant={pace.tone === "ok" ? "success" : pace.tone === "warning" ? "warning" : "destructive"} data-testid="platform-ai-pace">
            {pace.tone === "ok" ? "Vas bien" : pace.tone === "warning" ? "Vas rápido" : "Te pasaste"}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <p className="min-w-0 truncate">
                <span className="text-2xl font-semibold tabular-nums" data-testid="platform-ai-spent">
                  {formatUsd2(b.spentThisMonth)}
                </span>
                {b.monthlyUsd !== null && <span className="text-sm text-text-2"> de {formatUsd2(b.monthlyUsd)} este mes</span>}
              </p>
              {pct !== null && <span className="text-xs text-text-2">{pct} %</span>}
            </div>
            {pct !== null && (
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", pace.tone === "danger" ? "bg-destructive" : pace.tone === "warning" ? "bg-warning" : "bg-brand")}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-text-2">Quedan en créditos</p>
            <p className="text-lg font-semibold tabular-nums">{formatUsd2(pace.remainingUsd)}</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-text-2">Suma de topes de empresas</p>
            <p className="text-lg font-semibold tabular-nums" data-testid="platform-ai-caps-sum">
              {formatUsd2(b.companiesCapUsd)} <span className="text-xs font-normal text-text-2">/ mes</span>
            </p>
            {b.companiesWithoutCap > 0 && (
              <p className="text-[11px] text-warning-text">
                {b.companiesWithoutCap} {b.companiesWithoutCap === 1 ? "empresa" : "empresas"} sin tope en dólares
              </p>
            )}
          </div>
        </div>
        <p className="text-xs text-text-3">Gasto estimado con el precio de cada modelo; la factura de AWS puede variar un poco.</p>
        {editing ? (
          <div className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <div className="space-y-1">
              <Label className="text-xs">Presupuesto al mes (USD)</Label>
              <Input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} data-testid="platform-ai-budget" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Créditos (USD)</Label>
              <Input inputMode="decimal" value={credits} onChange={(e) => setCredits(e.target.value)} data-testid="platform-ai-credits-usd" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Desde (mes)</Label>
              <Input type="month" value={since} onChange={(e) => setSince(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()} data-testid="platform-ai-credits-save">
                Guardar
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            </div>
            {error && <p className="text-sm text-destructive sm:col-span-4">{error}</p>}
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="platform-ai-credits-edit">
            Cambiar créditos y presupuesto
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/* ───────── Modelos de Dashfort ───────── */

type Values = { agentModel: string | null; agentEffort: AiEffort | null; creatorModel: string | null; creatorEffort: AiEffort | null; assistantModel: string | null };

function valuesOf(row: Values): Values {
  return {
    agentModel: row.agentModel,
    agentEffort: row.agentEffort,
    creatorModel: row.creatorModel,
    creatorEffort: row.creatorEffort,
    assistantModel: row.assistantModel,
  };
}

function InstanceModelsCard({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  const inst = data.scopes.instance;
  const [draft, setDraft] = useState<Values>(valuesOf(inst));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [probes, setProbes] = useState<ProbeResult[] | null>(null);
  useEffect(() => setDraft(valuesOf(inst)), [inst]);

  // Lo que se ve si el campo queda vacío: el de las variables de entorno.
  const envView = (fn: AiFunction) => inst.effective[fn];
  const effModel = (fn: AiFunction) => draft[MODEL_KEY[fn]] ?? (inst.effective[fn].origin === "entorno" ? inst.effective[fn].model : null);

  async function save() {
    setBusy(true);
    const r = await api("/api/platform/ai-settings", { method: "PUT", body: JSON.stringify({ kind: "defaults", scope: "instance", ...draft }) });
    setBusy(false);
    setMsg(r.ok ? "Guardado. Aplica en máximo un minuto." : r.error);
    if (r.ok) onSaved();
  }

  async function probe() {
    setBusy(true);
    const models = [...new Set(FUNCS.map((f) => effModel(f.fn)).filter((m): m is string => !!m))];
    const out: ProbeResult[] = [];
    for (const model of models) {
      const r = await api<{ result: ProbeResult }>("/api/platform/ai-models/test", { method: "POST", body: JSON.stringify({ model }) });
      out.push(r.data?.result ?? { role: "main", ok: false, model, latencyMs: 0, detail: r.error ?? "Error" });
    }
    setProbes(out);
    setBusy(false);
  }

  const conn = data.connection;
  const provider = conn.provider === "bedrock" ? "AWS Bedrock" : conn.provider === "openrouter" ? "OpenRouter" : conn.host ?? "sin proveedor";
  return (
    <Card data-testid="platform-ai-models">
      <CardHeader>
        <CardTitle>Modelos de Dashfort</CardTitle>
        <CardDescription>Los usan todas las empresas, salvo que su plan o su ficha digan otra cosa.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] gap-x-4 border-b pb-2 text-xs text-text-2 md:grid">
          <span>Función</span>
          <span>Modelo</span>
          <span>Esfuerzo</span>
          <span className="text-right">Costo aprox.</span>
        </div>
        <ul className="divide-y">
          {FUNCS.map(({ fn, label, hint }) => (
            <li
              key={fn}
              className="grid gap-x-4 gap-y-2 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] md:items-center"
              data-testid={`platform-ai-fn-${fn}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-text-2">{hint}</p>
              </div>
              <ModelSelect
                value={draft[MODEL_KEY[fn]]}
                onChange={(v) => setDraft({ ...draft, [MODEL_KEY[fn]]: v })}
                catalog={data.catalog}
                inheritLabel={`Variable de entorno (${envView(fn).origin === "entorno" ? envView(fn).modelLabel : "—"})`}
                testId={`platform-ai-model-${fn}`}
              />
              {fn === "assistant" ? (
                <AssistantModes />
              ) : (
                <EffortSelect
                  value={draft[EFFORT_KEY[fn]]}
                  onChange={(v) => setDraft({ ...draft, [EFFORT_KEY[fn]]: v })}
                  inheritLabel="Bajo (por defecto)"
                  testId={`platform-ai-effort-${fn}`}
                />
              )}
              <p className="text-sm text-text-2 md:text-right">{costText(fn, priceOf(data.catalog, effModel(fn)))}</p>
            </li>
          ))}
        </ul>
        {probes && (
          <ul className="space-y-1 rounded-md bg-muted/50 p-3 text-sm" data-testid="platform-ai-probes">
            {probes.map((p) => (
              <li key={p.model ?? "x"} className={p.ok ? "text-success-text" : "text-danger-text"}>
                {p.ok ? "✓" : "✗"} {p.model} · {(p.latencyMs / 1000).toFixed(1)} s{p.detail ? ` · ${p.detail}` : ""}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-text-2">
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Conexión: {provider}
            {conn.host && conn.provider === "bedrock" ? ` (${conn.host.split(".")[1] ?? ""})` : ""} · {conn.hasToken ? "llave puesta" : "sin llave"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {msg && <span className="text-xs text-text-2">{msg}</span>}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void probe()} data-testid="platform-ai-probe">
              Probar conexión
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void save()} data-testid="platform-ai-models-save">
              Guardar
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ───────── Valores por plan ───────── */

function PlanRow({ scope, label, data, onSaved }: { scope: "esencial" | "pro" | "ultra"; label: string; data: Overview; onSaved: () => void }) {
  const row = data.scopes[scope];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Values>(valuesOf(row));
  const [cap, setCap] = useState(row.monthlyUsdLimit?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(valuesOf(row));
    setCap(row.monthlyUsdLimit?.toString() ?? "");
  }, [row]);

  const agentPrice = priceOf(data.catalog, row.effective.agent.model);
  const own = FUNCS.filter(({ fn }) => row.effective[fn].origin === "plan" || (fn !== "assistant" && row.effective[fn].effortOrigin === "plan"));

  async function save() {
    const n = cap.trim() === "" ? null : Number(cap);
    if (n !== null && (!Number.isFinite(n) || n < 0)) return setError("Escribe un monto en dólares (o déjalo vacío para no tener tope).");
    const r = await api("/api/platform/ai-settings", {
      method: "PUT",
      body: JSON.stringify({ kind: "defaults", scope, ...draft, monthlyUsdLimit: n }),
    });
    if (!r.ok) return setError(r.error);
    setError(null);
    setOpen(false);
    onSaved();
  }

  const instance = data.scopes.instance.effective;
  return (
    <li className="py-3" data-testid={`platform-ai-plan-${scope}`}>
      <div className="grid grid-cols-2 items-center gap-x-4 gap-y-1 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto]">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm tabular-nums" data-testid={`platform-ai-plan-${scope}-cap`}>
          {row.monthlyUsdLimit === null ? <span className="text-warning-text">Sin tope</span> : formatUsd2(row.monthlyUsdLimit)}
        </span>
        <span className="text-sm text-text-2">{row.monthlyUsdLimit === null ? "—" : `≈ ${formatMtok(usdToMtok(row.monthlyUsdLimit, agentPrice))}`}</span>
        <span className="flex min-w-0 flex-wrap gap-1.5">
          {own.length === 0 ? (
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-text-2">Los de Dashfort</span>
          ) : (
            own.map(({ fn, label: l }) => (
              <span key={fn} className="rounded-md bg-brand-tint px-2 py-0.5 text-xs text-brand-text">
                {l}: {viewLabel(row.effective[fn])}
              </span>
            ))
          )}
        </span>
        <Button size="sm" variant="ghost" className="justify-self-end text-brand-text" onClick={() => setOpen((o) => !o)} data-testid={`platform-ai-plan-${scope}-edit`}>
          {open ? "Cerrar" : "Editar"}
        </Button>
      </div>
      {open && (
        <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr] sm:items-end">
            <div className="space-y-1">
              <Label className="text-xs">Tope de IA al mes (USD)</Label>
              <Input inputMode="decimal" value={cap} placeholder="Sin tope" onChange={(e) => setCap(e.target.value)} data-testid={`platform-ai-plan-${scope}-cap-input`} />
            </div>
            <p className="text-xs text-text-2">
              {cap.trim() && Number.isFinite(Number(cap))
                ? `≈ ${formatMtok(usdToMtok(Number(cap), agentPrice))} con el modelo de agentes de este plan.`
                : "Vacío = sin tope (no recomendado)."}{" "}
              Al llegar al tope, los agentes pasan los chats a una persona.
            </p>
          </div>
          {FUNCS.map(({ fn, label: l }) => (
            <div key={fn} className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
              <span className="text-sm">{l}</span>
              <ModelSelect
                value={draft[MODEL_KEY[fn]]}
                onChange={(v) => setDraft({ ...draft, [MODEL_KEY[fn]]: v })}
                catalog={data.catalog}
                inheritLabel={`De Dashfort (${instance[fn].modelLabel})`}
                testId={`platform-ai-plan-${scope}-model-${fn}`}
              />
              {fn === "assistant" ? (
                <AssistantModes />
              ) : (
                <EffortSelect
                  value={draft[EFFORT_KEY[fn]]}
                  onChange={(v) => setDraft({ ...draft, [EFFORT_KEY[fn]]: v })}
                  inheritLabel={`De Dashfort (${instance[fn].effort ? AI_EFFORT_LABEL[instance[fn].effort!] : "—"})`}
                />
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void save()} data-testid={`platform-ai-plan-${scope}-save`}>
              Guardar plan {label}
            </Button>
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </div>
      )}
    </li>
  );
}

function PlansCard({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  return (
    <Card data-testid="platform-ai-plans">
      <CardHeader>
        <CardTitle>Valores por plan</CardTitle>
        <CardDescription>Lo que recibe cada empresa de ese plan, salvo lo que su ficha diga.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="hidden grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto] gap-x-4 border-b pb-2 text-xs text-text-2 md:grid">
          <span>Plan</span>
          <span>Tope de IA al mes</span>
          <span>Equivale a</span>
          <span>Modelos</span>
          <span className="w-14" />
        </div>
        <ul className="divide-y">
          {PLANS.map((p) => (
            <PlanRow key={p.scope} scope={p.scope} label={p.label} data={data} onSaved={onSaved} />
          ))}
        </ul>
        <p className="pt-3 text-xs text-text-2">Los millones de tokens son aproximados: dependen del modelo y de cuánto escribe cada respuesta.</p>
      </CardContent>
    </Card>
  );
}

/* ───────── Precio por modelo ───────── */

function PricesCard({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [inp, setInp] = useState("");
  const [out, setOut] = useState("");
  const [newModel, setNewModel] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save(model: string, clear = false) {
    const r = await api("/api/platform/ai-settings", {
      method: "PUT",
      body: JSON.stringify({
        kind: "price",
        model,
        price: clear ? null : { inputUsdPerMtok: Number(inp), outputUsdPerMtok: Number(out) },
      }),
    });
    if (!r.ok) return setError(r.error);
    setError(null);
    setEdit(null);
    setNewModel("");
    onSaved();
  }

  const open = (id: string, p: Price | null) => {
    setEdit(id);
    setInp(p?.inputUsdPerMtok.toString() ?? "");
    setOut(p?.outputUsdPerMtok.toString() ?? "");
  };

  return (
    <Card data-testid="platform-ai-prices">
      <CardHeader>
        <CardTitle>Precio de cada modelo</CardTitle>
        <CardDescription>USD por millón de tokens. Con ellos se calcula el gasto y los topes en dólares.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="divide-y">
          {data.catalog.map((c) => (
            <li key={c.id} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="text-sm font-medium">{c.label}</span>{" "}
                  <span className="break-all text-xs text-text-3">{c.id}</span>
                </span>
                <span className="flex items-center gap-2 text-sm tabular-nums text-text-2">
                  {c.price ? `${c.price.inputUsdPerMtok} entrada · ${c.price.outputUsdPerMtok} salida` : "Sin precio"}
                  {c.price && (
                    <Badge variant="secondary">{c.price.source === "platform" ? "Tuyo" : "Lista conocida"}</Badge>
                  )}
                  <Button size="sm" variant="ghost" className="text-brand-text" onClick={() => open(c.id, c.price)}>
                    Cambiar
                  </Button>
                </span>
              </div>
              {edit === c.id && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="w-28 space-y-1">
                    <Label className="text-xs">Entrada</Label>
                    <Input inputMode="decimal" value={inp} onChange={(e) => setInp(e.target.value)} />
                  </div>
                  <div className="w-28 space-y-1">
                    <Label className="text-xs">Salida</Label>
                    <Input inputMode="decimal" value={out} onChange={(e) => setOut(e.target.value)} />
                  </div>
                  <Button size="sm" onClick={() => void save(c.id)}>
                    Guardar
                  </Button>
                  {c.price?.source === "platform" && (
                    <Button size="sm" variant="outline" onClick={() => void save(c.id, true)}>
                      Usar el de la lista
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <div className="min-w-0 flex-1 space-y-1">
            <Label className="text-xs">Otro modelo (nombre exacto del proveedor)</Label>
            <Input value={newModel} placeholder="global.anthropic.claude-…" onChange={(e) => setNewModel(e.target.value)} />
          </div>
          <Button size="sm" variant="outline" disabled={!newModel.trim()} onClick={() => open(newModel.trim(), null)}>
            Agregar precio
          </Button>
        </div>
        {edit && !data.catalog.some((c) => c.id === edit) && (
          <div className="flex flex-wrap items-end gap-2">
            <span className="text-sm">{edit}</span>
            <div className="w-28 space-y-1">
              <Label className="text-xs">Entrada</Label>
              <Input inputMode="decimal" value={inp} onChange={(e) => setInp(e.target.value)} />
            </div>
            <div className="w-28 space-y-1">
              <Label className="text-xs">Salida</Label>
              <Input inputMode="decimal" value={out} onChange={(e) => setOut(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => void save(edit)}>
              Guardar
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

export function AiModelsClient() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await api<Overview>("/api/platform/ai-settings");
    if (r.data) setData(r.data);
    else setError(r.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data) return <p className="text-sm text-text-2">{error ?? "Cargando modelos…"}</p>;
  return (
    <div className="space-y-4" data-testid="platform-ai-settings">
      <InstanceModelsCard data={data} onSaved={() => void load()} />
      <CreditsCard data={data} onSaved={() => void load()} />
      <PlansCard data={data} onSaved={() => void load()} />
      <PricesCard data={data} onSaved={() => void load()} />
    </div>
  );
}
