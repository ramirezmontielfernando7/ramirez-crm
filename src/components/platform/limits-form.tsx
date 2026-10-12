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
  type AlertMetric,
  type EffectiveLimits,
  type Limit,
  type LimitsPatch,
  type StorageMode,
} from "@/lib/limits";
import { formatStorage, formatTokens } from "@/lib/usage";
import { api } from "./api";

/**
 * 036 (PR 3a) — Plan y topes de UNA organización (solo el administrador de
 * plataforma). Un campo vacío HEREDA (del entorno o sin tope) y dice de
 * dónde; escribir un número lo fija para esta organización. Bajar un tope
 * por debajo del uso no quita nada: solo impide crecer. Funcional, sin pulir.
 */

type Alert = { metric: AlertMetric; threshold: number; used: number; limit: number; seenAt: string | null };
type Field = keyof Omit<LimitsPatch, "planKey" | "storageMode">;

const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** Cada campo: etiqueta, unidad y cómo pasar de lo que se escribe a lo que se guarda. */
const FIELDS: { key: Field; label: string; unit: string; toValue: (n: number) => number; fromValue: (v: number) => number; fmt: (v: number) => string }[] = [
  { key: "aiTokens", label: "IA: tokens al mes", unit: "tokens", toValue: (n) => n, fromValue: (v) => v, fmt: formatTokens },
  { key: "aiTurns", label: "IA: turnos al mes", unit: "turnos", toValue: (n) => n, fromValue: (v) => v, fmt: (v) => v.toLocaleString("es-MX") },
  { key: "embedTokens", label: "Embeddings: tokens al mes", unit: "tokens", toValue: (n) => n, fromValue: (v) => v, fmt: formatTokens },
  { key: "storageBytes", label: "Almacenamiento (aprox.)", unit: "GB", toValue: (n) => Math.round(n * GB), fromValue: (v) => Math.round((v / GB) * 100) / 100, fmt: formatStorage },
  { key: "members", label: "Personas", unit: "personas", toValue: (n) => n, fromValue: (v) => v, fmt: (v) => String(v) },
  { key: "modules", label: "Módulos activos (de 12)", unit: "módulos", toValue: (n) => n, fromValue: (v) => v, fmt: (v) => String(v) },
  { key: "kbMaxDocuments", label: "Documentos del agente", unit: "documentos", toValue: (n) => n, fromValue: (v) => v, fmt: (v) => String(v) },
  { key: "kbMaxChunks", label: "Fragmentos de documentos", unit: "fragmentos", toValue: (n) => n, fromValue: (v) => v, fmt: (v) => String(v) },
  { key: "kbMaxFileBytes", label: "Tamaño máx. por documento", unit: "MB", toValue: (n) => Math.round(n * MB), fromValue: (v) => Math.round((v / MB) * 10) / 10, fmt: formatStorage },
];

function hint(limit: Limit, fmt: (v: number) => string): string {
  if (limit.source === "org") return "Propio de esta organización";
  if (limit.source === "env") return `Hereda: ${fmt(limit.value!)} (entorno)`;
  return "Hereda: sin tope";
}

export function LimitsForm({ orgId, onSaved }: { orgId: string; onSaved: () => void }) {
  const [limits, setLimits] = useState<EffectiveLimits | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [draft, setDraft] = useState<Record<Field, string>>({} as Record<Field, string>);
  const [mode, setMode] = useState<StorageMode>("warn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function fill(l: EffectiveLimits, a: Alert[]) {
    setLimits(l);
    setAlerts(a);
    setMode(l.storageMode);
    const d = {} as Record<Field, string>;
    for (const f of FIELDS) {
      const lim = l[f.key];
      d[f.key] = lim.source === "org" && lim.value !== null ? String(f.fromValue(lim.value)) : "";
    }
    setDraft(d);
  }

  useEffect(() => {
    void api<{ limits: EffectiveLimits; alerts: Alert[] }>(`/api/platform/organizations/${orgId}/limits`).then((r) => {
      if (r.data) fill(r.data.limits, r.data.alerts);
      else setError(r.error);
    });
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
      <p className="text-xs font-medium text-text-2">Plan y topes</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Label htmlFor={`plan-${orgId}`} className="text-xs text-text-2">
          Plan
        </Label>
        <select id={`plan-${orgId}`} className="h-8 rounded-sm border bg-background px-2 text-sm" value="custom" disabled data-testid="platform-plan">
          <option value="custom">{PLAN_LABEL.custom}</option>
        </select>
        <span className="text-xs text-text-3">Sin plan base: todos los topes son ajustes manuales.</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => (
          <div key={f.key} className="min-w-0 space-y-1">
            <Label htmlFor={`${f.key}-${orgId}`} className="text-xs">
              {f.label} <span className="text-text-3">({f.unit})</span>
            </Label>
            <Input
              id={`${f.key}-${orgId}`}
              inputMode="decimal"
              className="h-8"
              placeholder={limits[f.key].source === "org" ? "" : hint(limits[f.key], f.fmt)}
              value={draft[f.key] ?? ""}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              data-testid={`platform-limit-${f.key}`}
            />
            <p className="truncate text-[11px] text-text-3">{hint(limits[f.key], f.fmt)}</p>
          </div>
        ))}
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`mode-${orgId}`} className="text-xs">
            Al llegar al tope de almacenamiento
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
          <p className="text-[11px] text-text-3">
            Bloquear afecta documentos, Conocimientos y adjuntos del chat de equipo. WhatsApp siempre se recibe.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save()} data-testid="platform-limits-save">
          {busy ? "Guardando…" : "Guardar topes"}
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
