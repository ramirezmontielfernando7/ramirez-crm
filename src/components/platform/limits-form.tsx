"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ALERT_METRIC_LABEL,
  PLAN_LABEL,
  STORAGE_MODE_LABEL,
  STORAGE_MODES,
  USAGE_VISIBILITIES,
  USAGE_VISIBILITY_EXAMPLE,
  USAGE_VISIBILITY_LABEL,
  type AlertMetric,
  type EffectiveLimits,
  type Limit,
  type LimitsPatch,
  type StorageMode,
  type UsageVisibility,
} from "@/lib/limits";
import { PLATFORM_MODULE_TOGGLES } from "@/lib/platform-modules";
import { formatStorage } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { api } from "./api";

/**
 * 036 (PR 3a) — Plan y topes de UNA organización (solo el administrador de
 * plataforma). Un campo vacío HEREDA (del entorno o sin tope) y dice de
 * dónde; escribir un número lo fija para esta organización. Bajar un tope
 * por debajo del uso no quita nada: solo impide crecer. Funcional, sin pulir.
 */

type Alert = { metric: AlertMetric; threshold: number; used: number; limit: number; seenAt: string | null };
type Field = keyof Omit<LimitsPatch, "storageMode" | "usageVisibility">;

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** Cada campo: etiqueta, unidad y cómo pasar de lo que se escribe a lo que se guarda. */
type FieldDef = { key: Field; label: string; unit: string; toValue: (n: number) => number; fromValue: (v: number) => number; fmt: (v: number) => string };
const FIELDS: FieldDef[] = [
  { key: "storageBytes", label: "Almacenamiento en la nube", unit: "GB", toValue: (n) => Math.round(n * GB), fromValue: (v) => Math.round((v / GB) * 100) / 100, fmt: formatStorage },
  { key: "members", label: "Personas del equipo", unit: "personas", toValue: (n) => n, fromValue: (v) => v, fmt: (v) => String(v) },
  // 0071 — Topes de seguridad (avanzado). Los documentos no tienen límite de cantidad: cuentan en el almacenamiento.
  { key: "kbMaxTotalBytes", label: "Documentos de los agentes, máximo", unit: "GB", toValue: (n) => Math.round(n * GB), fromValue: (v) => Math.round((v / GB) * 100) / 100, fmt: formatStorage },
  { key: "kbMaxFileBytes", label: "Tamaño máximo por documento", unit: "MB", toValue: (n) => Math.round(n * MB), fromValue: (v) => Math.round((v / MB) * 10) / 10, fmt: formatStorage },
  { key: "modules", label: `Módulos activos (de ${PLATFORM_MODULE_TOGGLES.length})`, unit: "módulos", toValue: (n) => n, fromValue: (v) => v, fmt: (v) => String(v) },
];
const MAIN_FIELDS = FIELDS.slice(0, 2);
const ADVANCED_FIELDS = FIELDS.slice(2);

function hint(limit: Limit, fmt: (v: number) => string, key?: Field): string {
  if (limit.source === "org") return "Propio de esta organización";
  if (key === "kbMaxTotalBytes") return "Freno de seguridad: 1 GB si lo dejas vacío";
  if (limit.source === "env") return `Hereda: ${fmt(limit.value!)} (entorno)`;
  return "Hereda: sin tope";
}

function FieldInput({
  f,
  orgId,
  limits,
  draft,
  setDraft,
}: {
  f: FieldDef;
  orgId: string;
  limits: EffectiveLimits;
  draft: Record<Field, string>;
  setDraft: (d: Record<Field, string>) => void;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={`${f.key}-${orgId}`} className="text-xs">
        {f.label} <span className="text-text-3">({f.unit})</span>
      </Label>
      <Input
        id={`${f.key}-${orgId}`}
        inputMode="decimal"
        className="h-8"
        placeholder={limits[f.key].source === "org" ? "" : hint(limits[f.key], f.fmt, f.key)}
        value={draft[f.key] ?? ""}
        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
        data-testid={`platform-limit-${f.key}`}
      />
      <p className="truncate text-[11px] text-text-3">{hint(limits[f.key], f.fmt, f.key)}</p>
    </div>
  );
}

export function LimitsForm({ orgId, onSaved }: { orgId: string; onSaved: () => void }) {
  const [limits, setLimits] = useState<EffectiveLimits | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [draft, setDraft] = useState<Record<Field, string>>({} as Record<Field, string>);
  const [mode, setMode] = useState<StorageMode>("warn");
  const [visibility, setVisibility] = useState<UsageVisibility>("percent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function fill(l: EffectiveLimits, a: Alert[]) {
    setLimits(l);
    setAlerts(a);
    setMode(l.storageMode);
    setVisibility(l.usageVisibility);
    const d = {} as Record<Field, string>;
    for (const f of FIELDS) {
      const lim = l[f.key];
      d[f.key] = lim.source === "org" && lim.value !== null ? String(f.fromValue(lim.value)) : "";
    }
    setDraft(d);
  }

  useEffect(() => {
    // Una respuesta vieja (otra organización, o el doble montaje de desarrollo)
    // no debe pisar lo que la persona ya escribió en el formulario.
    let vivo = true;
    void api<{ limits: EffectiveLimits; alerts: Alert[] }>(`/api/platform/organizations/${orgId}/limits`).then((r) => {
      if (!vivo) return;
      if (r.data) fill(r.data.limits, r.data.alerts);
      else setError(r.error);
    });
    return () => {
      vivo = false;
    };
  }, [orgId]);

  if (!limits) return <p className="text-sm text-text-2">{error ?? "Cargando topes…"}</p>;

  async function save() {
    if (!limits) return;
    const patch: LimitsPatch = {};
    for (const f of FIELDS) {
      const raw = draft[f.key].trim().replace(",", ".");
      const actual = limits[f.key];
      const antes = actual.source === "org" && actual.value !== null ? String(f.fromValue(actual.value)) : "";
      if (raw === antes) continue;
      if (raw === "") {
        patch[f.key] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setError(`«${f.label}»: escribe un número mayor o igual a 0, o déjalo vacío para heredar`);
        return;
      }
      patch[f.key] = f.toValue(n);
    }
    if (mode !== limits.storageMode) patch.storageMode = mode;
    if (visibility !== limits.usageVisibility) patch.usageVisibility = visibility;
    if (Object.keys(patch).length === 0) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await api<{ limits: EffectiveLimits; alerts: Alert[] }>(`/api/platform/organizations/${orgId}/limits`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (!r.data) {
      setError(r.error);
      return;
    }
    fill(r.data.limits, r.data.alerts);
    setSaved(true);
    onSaved();
  }

  return (
    <section className="space-y-3" data-testid="platform-limits">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-text-2">Plan guardado</span>
        <span
          className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium"
          data-testid="platform-plan"
          data-plan={limits.planKey}
        >
          {PLAN_LABEL[limits.planKey]}
        </span>
        <span className="text-xs text-text-3">Lo deciden los 13 módulos; estos topes son ajustes encima del plan.</span>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Qué ve el cliente de su consumo de IA</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-2" role="radiogroup" aria-label="Qué ve el cliente de su consumo de IA">
          {USAGE_VISIBILITIES.map((v) => (
            <label
              key={v}
              className={cn(
                "min-w-0 cursor-pointer rounded-md border px-3 py-2 text-sm",
                visibility === v ? "border-brand bg-brand-tint" : "bg-card"
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name={`visibility-${orgId}`}
                  checked={visibility === v}
                  onChange={() => setVisibility(v)}
                  data-testid={`platform-limit-usageVisibility-${v}`}
                />
                {USAGE_VISIBILITY_LABEL[v]}
              </span>
              <span className="mt-0.5 block text-xs text-text-3">{USAGE_VISIBILITY_EXAMPLE[v]}</span>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-text-3">Se ve en «Uso y plan», en los avisos y en el asistente. Tú siempre ves todo.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2">
        {MAIN_FIELDS.map((f) => (
          <FieldInput key={f.key} f={f} orgId={orgId} limits={limits} draft={draft} setDraft={setDraft} />
        ))}
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`mode-${orgId}`} className="text-xs">
            Al llenarse el almacenamiento
          </Label>
          <select
            id={`mode-${orgId}`}
            className="h-8 w-full rounded-sm border bg-background px-2 text-sm"
            value={mode}
            onChange={(e) => setMode(e.target.value as StorageMode)}
            data-testid="platform-limit-storageMode"
          >
            {STORAGE_MODES.map((m) => (
              <option key={m} value={m}>
                {STORAGE_MODE_LABEL[m]}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-text-3">WhatsApp siempre se recibe.</p>
        </div>
      </div>
      <p className="text-[11px] text-text-3">El almacenamiento incluye fotos y archivos de WhatsApp, Conocimientos, chat de equipo y documentos de los agentes. Vacío = sin límite.</p>

      <details className="rounded-md border px-3 py-2" data-testid="platform-limits-advanced">
        <summary className="cursor-pointer text-sm text-brand-text">Topes de seguridad (avanzado)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2">
          {ADVANCED_FIELDS.map((f) => (
            <FieldInput key={f.key} f={f} orgId={orgId} limits={limits} draft={draft} setDraft={setDraft} />
          ))}
        </div>
        <p className="mt-2 text-[11px] text-text-3">
          Los documentos no tienen límite de cantidad: cuentan dentro del almacenamiento. Los topes por función de IA (agentes, creador, asistente) están en «Tope mensual de IA».
          Ya no se muestran: fragmentos (son internos y no cuestan), turnos y los topes de tokens de antes (los reemplaza la bolsa en dólares).
        </p>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save()} data-testid="platform-limits-save">
          {busy ? "Guardando…" : "Guardar límites"}
        </Button>
        {saved && <span className="text-xs text-text-2" data-testid="platform-limits-saved">Guardado</span>}
        <span className="text-xs text-text-3">Vacío = hereda. Bajar un tope no quita nada: solo impide crecer.</span>
      </div>
      {error && (
        <p className="text-sm text-destructive" data-testid="platform-limits-error">
          {error}
        </p>
      )}

      <div>
        <p className="text-xs font-medium text-text-2">Avisos de este mes</p>
        {alerts.length === 0 ? (
          <p className="text-sm text-text-3">Ninguno.</p>
        ) : (
          <ul className="text-sm" data-testid="platform-limit-alerts">
            {alerts.map((a) => (
              <li key={a.metric}>
                {a.threshold} % de {ALERT_METRIC_LABEL[a.metric]} ({a.used.toLocaleString("es-MX")} de{" "}
                {a.limit.toLocaleString("es-MX")}){a.seenAt ? " · visto por el Propietario" : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
