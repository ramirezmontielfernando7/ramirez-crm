"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AI_EFFORT_LABEL, type AiEffort, type AiFunction } from "@/lib/ai/choice";
import { formatMtok, formatUsd2, mtokToUsd, usdToMtok, type Price } from "@/lib/ai-plans";
import { CAP_UNIT_LABEL, CAP_UNITS, capUsd, checkCaps, type CapUnit, type FnCapValue } from "@/lib/fn-caps";
import { PLAN_LABEL } from "@/lib/limits";
import { cn } from "@/lib/utils";
import type { AiSettingsOverview, OrgAiView } from "@/server/ai-settings/admin";
import { AssistantModes, EFFORT_KEY, EffortSelect, MODEL_KEY, ModelSelect, priceOf } from "./ai-models-client";
import { api } from "./api";

/**
 * 0070 — Ficha de una empresa → «IA y topes»: su tope mensual de IA (en
 * dólares o en millones de tokens, con la equivalencia) y sus modelos por
 * función. Vacío = hereda del plan (o de los «Modelos de Dashfort»).
 */

const FUNCS: { fn: AiFunction; label: string }[] = [
  { fn: "agent", label: "Agentes" },
  { fn: "creator", label: "Creador de agentes" },
  { fn: "assistant", label: "Asistente" },
];

type Draft = {
  agentModel: string | null;
  agentEffort: AiEffort | null;
  creatorModel: string | null;
  creatorEffort: AiEffort | null;
  assistantModel: string | null;
};

const draftOf = (v: OrgAiView): Draft => ({
  agentModel: v.overrides.agentModel,
  agentEffort: v.overrides.agentEffort,
  creatorModel: v.overrides.creatorModel,
  creatorEffort: v.overrides.creatorEffort,
  assistantModel: v.overrides.assistantModel,
});

/** Primer día del mes siguiente (UTC), para «se renueva el…». */
function renewal(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toLocaleDateString("es-MX", { day: "numeric", month: "long", timeZone: "UTC" });
}

export function OrgAiCard({ orgId }: { orgId: string }) {
  const [view, setView] = useState<OrgAiView | null>(null);
  const [catalog, setCatalog] = useState<AiSettingsOverview["catalog"]>([]);
  const [unit, setUnit] = useState<"usd" | "mtok">("usd");
  const [cap, setCap] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  // 0071/0072: reparto por función (unidad y valor tal cual) y qué hacer al llegar.
  type CapDraft = { unit: CapUnit; value: string };
  const [fnCaps, setFnCaps] = useState<Record<AiFunction, CapDraft>>({ agent: { unit: "pct", value: "" }, creator: { unit: "pct", value: "" }, assistant: { unit: "pct", value: "" } });
  const [fnModes, setFnModes] = useState<Record<AiFunction, "block" | "warn">>({ agent: "block", creator: "block", assistant: "block" });
  const [poolMode, setPoolMode] = useState<"block" | "warn">("block");
  const [safetyMsg, setSafetyMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [v, o] = await Promise.all([
      api<OrgAiView>(`/api/platform/organizations/${orgId}/ai`),
      api<AiSettingsOverview>("/api/platform/ai-settings"),
    ]);
    if (v.data) {
      setView(v.data);
      setDraft(draftOf(v.data));
      setCap(v.data.overrides.monthlyUsdLimit?.toString() ?? "");
      const o = v.data.overrides;
      const d = (fn: AiFunction): CapDraft => ({ unit: o.caps[fn].unit, value: o.caps[fn].value?.toString() ?? "" });
      setFnCaps({ agent: d("agent"), creator: d("creator"), assistant: d("assistant") });
      setFnModes({ agent: o.agentMode, creator: o.creatorMode, assistant: o.assistantMode });
      setPoolMode(o.poolMode);
      setUnit("usd");
    } else setError(v.error);
    if (o.data) setCatalog(o.data.catalog);
  }, [orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!view || !draft) return <p className="text-sm text-text-2">{error ?? "Cargando IA…"}</p>;

  // El precio con que se convierte: el modelo de agentes que quedaría.
  const agentModel = draft.agentModel ?? view.inherited.agent.model;
  const price: Price | null = priceOf(catalog, agentModel);
  const n = cap.trim() === "" ? null : Number(cap);
  const capUsdValue = n === null || !Number.isFinite(n) ? null : unit === "usd" ? n : mtokToUsd(n, price);
  const effectiveCap = capUsdValue ?? view.inherited.monthlyUsdLimit;
  const ratio = effectiveCap ? view.spentThisMonth / effectiveCap : null;
  const pct = ratio === null ? null : Math.round(ratio * 100);
  const capOrigin = view.overrides.monthlyUsdLimit !== null ? "Propio" : view.plan ? `Del ${(PLAN_LABEL[view.plan as keyof typeof PLAN_LABEL] ?? "plan").replace("Plan ", "plan ")}` : "Sin plan";

  function switchUnit(u: "usd" | "mtok") {
    if (u === unit) return;
    const v = cap.trim() === "" ? null : Number(cap);
    if (v !== null && Number.isFinite(v)) {
      const conv = u === "mtok" ? usdToMtok(v, price) : mtokToUsd(v, price);
      if (conv !== null) setCap(String(Math.round(conv * 100) / 100));
    }
    setUnit(u);
  }

  async function save(patch: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    const r = await api<OrgAiView>(`/api/platform/organizations/${orgId}/ai`, { method: "PUT", body: JSON.stringify(patch) });
    setBusy(false);
    if (!r.ok) {
      setMsg(null);
      setError(r.error);
      return false;
    }
    setError(null);
    setMsg("Guardado. Aplica en máximo un minuto.");
    await load();
    return true;
  }

  function saveCap() {
    if (cap.trim() !== "" && (capUsdValue === null || capUsdValue < 0)) return setError(unit === "mtok" && !price ? "El modelo de agentes no tiene precio: escribe el tope en dólares." : "Escribe un número.");
    void save({ monthlyUsdLimit: capUsdValue === null ? null : Math.round(capUsdValue * 10000) / 10000, poolMode });
  }

  /** Lo que vale cada tope por función (dólares), con el total de arriba. */
  function capOf(fn: AiFunction): FnCapValue {
    const raw = fnCaps[fn].value.trim().replace(",", ".");
    const v = raw === "" ? null : Number(raw);
    if (v === null || !Number.isFinite(v) || v < 0) return { unit: fnCaps[fn].unit, value: null, usd: null };
    const unit = fnCaps[fn].unit;
    return { unit, value: v, usd: unit === "usd" ? v : unit === "mtok" ? mtokToUsd(v, price) : null };
  }
  const capsNow = (["agent", "creator", "assistant"] as const).map(capOf);
  const check = checkCaps(capsNow, effectiveCap);

  async function saveSafety() {
    setSafetyMsg(null);
    for (const fn of ["agent", "creator", "assistant"] as const) {
      const raw = fnCaps[fn].value.trim().replace(",", ".");
      if (raw !== "" && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) return setError("Escribe un número, o déjalo vacío para usar el total.");
      if (raw !== "" && fnCaps[fn].unit === "mtok" && !price) return setError("El modelo de agentes no tiene precio: usa dólares o porcentaje.");
    }
    if (!check.ok) return setError(check.message);
    const caps = { agent: capOf("agent"), creator: capOf("creator"), assistant: capOf("assistant") };
    const ok = await save({ caps, agentMode: fnModes.agent, creatorMode: fnModes.creator, assistantMode: fnModes.assistant });
    if (ok) setSafetyMsg("Guardado · aplica en máximo un minuto");
  }

  // Cuántas veces más caro es lo propio que lo heredado (solo agentes, lo que más gasta).
  const inheritedPrice = priceOf(catalog, view.inherited.agent.model);
  const ownPrice = view.overrides.agentModel ? priceOf(catalog, view.overrides.agentModel) : null;
  const factor = ownPrice && inheritedPrice && inheritedPrice.inputUsdPerMtok > 0 ? ownPrice.inputUsdPerMtok / inheritedPrice.inputUsdPerMtok : null;

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-lg border bg-card p-4" data-testid="platform-org-ai-cap">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Tope mensual de IA · total de la empresa</h2>
            <p className="text-xs text-text-3">Es el límite de todo: agentes, creador, asistente y lectura de documentos suman aquí. Avisos al 80 % y al 100 %.</p>
          </div>
          <Badge variant="secondary" data-testid="platform-org-ai-cap-origin">
            {capOrigin}
          </Badge>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <p className="text-xs text-text-2">Escribir en</p>
            <div className="inline-flex rounded-md bg-muted p-0.5 text-sm">
              {(["usd", "mtok"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => switchUnit(u)}
                  className={cn("rounded px-3 py-1", unit === u ? "bg-card font-medium shadow-sm" : "text-text-2")}
                  data-testid={`platform-org-ai-unit-${u}`}
                >
                  {u === "usd" ? "Dólares" : "Millones de tokens"}
                </button>
              ))}
            </div>
          </div>
          <div className="w-32 space-y-1">
            <p className="text-xs text-text-2">Tope</p>
            <Input
              inputMode="decimal"
              value={cap}
              placeholder={view.inherited.monthlyUsdLimit === null ? "Sin tope" : unit === "usd" ? String(view.inherited.monthlyUsdLimit) : ""}
              onChange={(e) => setCap(e.target.value)}
              data-testid="platform-org-ai-cap-input"
            />
          </div>
          <p className="pb-2 text-sm text-text-2">
            {unit === "usd" ? "USD al mes" : "M tokens al mes"}
            {effectiveCap !== null && (
              <>
                {" "}
                ≈{" "}
                <strong className="text-foreground">{unit === "usd" ? formatMtok(usdToMtok(effectiveCap, price)) : formatUsd2(effectiveCap)}</strong>{" "}
                con los modelos de esta empresa
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-xs text-text-2">Al llenarse el total</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={poolMode}
            onChange={(e) => setPoolMode(e.target.value as "block" | "warn")}
            aria-label="Al llenarse el total"
            data-testid="platform-org-ai-poolmode"
          >
            <option value="block">Bloquear</option>
            <option value="warn">Solo avisar</option>
          </select>
          <span className="text-xs text-text-3">Bloquear pasa los chats a una persona.</span>
        </div>
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span>
              Este mes: <strong data-testid="platform-org-ai-spent">{formatUsd2(view.spentThisMonth)}</strong>
              {effectiveCap !== null ? ` de ${formatUsd2(effectiveCap)}` : " (sin tope)"}
            </span>
            <span className="text-xs text-text-2">
              {pct !== null ? `${pct} % · ` : ""}se renueva el {renewal()}
            </span>
          </div>
          {pct !== null && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-brand")}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {msg && <span className="mr-auto text-xs text-text-2">{msg}</span>}
          {error && <span className="mr-auto text-xs text-destructive">{error}</span>}
          <Button size="sm" variant="outline" disabled={busy || view.overrides.monthlyUsdLimit === null} onClick={() => void save({ monthlyUsdLimit: null })} data-testid="platform-org-ai-cap-reset">
            Volver al del plan
          </Button>
          <Button size="sm" disabled={busy} onClick={saveCap} data-testid="platform-org-ai-cap-save">
            Guardar
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-4" data-testid="platform-org-ai-safety">
        <div>
          <h2 className="text-sm font-semibold">
            Reparto por función <span className="font-normal text-text-3">(opcional)</span>
          </h2>
          <p className="text-xs text-text-3">Si una función queda vacía, usa lo que haya disponible del total. Lo repartido no puede pasar del total.</p>
        </div>
        <ul className="divide-y">
          {FUNCS.map(({ fn, label }) => {
            const usd = capUsd(capOf(fn), effectiveCap);
            const filled = capOf(fn).value !== null;
            const eq =
              !filled
                ? effectiveCap !== null && check.ok
                  ? `usa lo que quede del total (${formatUsd2(Math.max(0, effectiveCap - check.repartidoUsd))})`
                  : "usa el total"
                : usd === null
                  ? "—"
                  : `= ${formatUsd2(usd)}${price ? ` · ${formatMtok(usdToMtok(usd, price))} tokens` : ""}${effectiveCap ? ` · ${Math.round((usd / effectiveCap) * 100)} %` : ""}`;
            return (
              <li key={fn} className="grid gap-2 py-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,9rem)_minmax(0,7rem)_minmax(0,1fr)_minmax(0,7.5rem)] sm:items-center">
                <span className="text-sm">{label}</span>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={fnCaps[fn].unit}
                  onChange={(e) => setFnCaps({ ...fnCaps, [fn]: { ...fnCaps[fn], unit: e.target.value as CapUnit } })}
                  aria-label={`Escribir en: ${label}`}
                  data-testid={`platform-org-ai-fnunit-${fn}`}
                >
                  {CAP_UNITS.map((u) => (
                    <option key={u} value={u}>
                      {CAP_UNIT_LABEL[u]}
                    </option>
                  ))}
                </select>
                <Input
                  inputMode="decimal"
                  placeholder="Vacío"
                  value={fnCaps[fn].value}
                  onChange={(e) => setFnCaps({ ...fnCaps, [fn]: { ...fnCaps[fn], value: e.target.value } })}
                  data-testid={`platform-org-ai-fncap-${fn}`}
                />
                <span className="text-xs text-text-3" data-testid={`platform-org-ai-fneq-${fn}`}>
                  {eq}
                </span>
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={fnModes[fn]}
                  onChange={(e) => setFnModes({ ...fnModes, [fn]: e.target.value as "block" | "warn" })}
                  aria-label={`Al llegar: ${label}`}
                  data-testid={`platform-org-ai-fnmode-${fn}`}
                >
                  <option value="block">Bloquear</option>
                  <option value="warn">Solo avisar</option>
                </select>
              </li>
            );
          })}
        </ul>
        {effectiveCap !== null && (
          <div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              {capsNow.map((c, i) => {
                const u = capUsd(c, effectiveCap) ?? 0;
                return <i key={i} className={i === 0 ? "bg-brand" : i === 1 ? "bg-brand/60" : "bg-brand/35"} style={{ width: `${Math.min(100, (u / effectiveCap) * 100)}%` }} />;
              })}
            </div>
            <p className={cn("mt-1 text-xs", check.ok ? "text-text-2" : "text-destructive")} data-testid="platform-org-ai-fnsum">
              {check.ok
                ? `Repartido ${Math.round(check.pct ?? 0)} % (${formatUsd2(check.repartidoUsd)} de ${formatUsd2(effectiveCap)}) · libre ${Math.max(0, 100 - Math.round(check.pct ?? 0))} %`
                : check.message}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {safetyMsg && (
            <span className="text-xs text-success-text" data-testid="platform-org-ai-safety-saved">
              ✓ {safetyMsg}
            </span>
          )}
          <Button size="sm" disabled={busy || !check.ok} onClick={() => void saveSafety()} data-testid="platform-org-ai-safety-save">
            Guardar topes de seguridad
          </Button>
        </div>
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-text-2">
          «% del total» sigue al total si lo cambias; en dólares o millones de tokens el valor queda fijo. Siempre ves el equivalente en gris.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-4" data-testid="platform-org-ai-models">
        <div>
          <h2 className="text-sm font-semibold">Modelos de esta empresa</h2>
          <p className="text-xs text-text-3">Cámbialo solo si el cliente siente que la IA se queda corta o va lenta.</p>
        </div>
        <ul className="divide-y">
          {FUNCS.map(({ fn, label }) => {
            const inh = view.inherited[fn];
            const from = inh.origin === "plan" ? "Del plan" : "De Dashfort";
            const isOwn = draft[MODEL_KEY[fn]] !== null || (fn !== "assistant" && draft[EFFORT_KEY[fn]] !== null);
            return (
              <li key={fn} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,13rem)] sm:items-center">
                <span className="text-sm">{label}</span>
                <ModelSelect
                  value={draft[MODEL_KEY[fn]]}
                  onChange={(v) => setDraft({ ...draft, [MODEL_KEY[fn]]: v })}
                  catalog={catalog}
                  inheritLabel={`${from} (${inh.modelLabel})`}
                  testId={`platform-org-ai-model-${fn}`}
                />
                {fn === "assistant" ? (
                  <AssistantModes />
                ) : (
                  <EffortSelect
                    value={draft[EFFORT_KEY[fn]]}
                    onChange={(v) => setDraft({ ...draft, [EFFORT_KEY[fn]]: v })}
                    inheritLabel={`${inh.effortOrigin === "plan" ? "Del plan" : "De Dashfort"} (${inh.effort ? AI_EFFORT_LABEL[inh.effort] : "—"})`}
                    testId={`platform-org-ai-effort-${fn}`}
                  />
                )}
                <span className="sm:text-right">
                  {isOwn && (
                    <Badge variant="warning" className="whitespace-nowrap">
                      Propio{fn === "agent" && factor && factor > 1.5 ? ` · cuesta ~${Math.round(factor)}× más` : ""}
                    </Badge>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-end">
          <Button size="sm" disabled={busy} onClick={() => void save({ ...draft })} data-testid="platform-org-ai-models-save">
            Guardar modelos
          </Button>
        </div>
      </section>
    </div>
  );
}
