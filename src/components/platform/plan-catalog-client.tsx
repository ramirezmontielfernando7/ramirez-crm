"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CATALOG_SCOPES, type CatalogScope, type PlanCatalog, type PlanCatalogEntry } from "@/lib/plan-catalog";
import { api } from "./api";

/**
 * Plataforma → Organizaciones y Planes → «Planes y precios»: nombre, precio en
 * pesos y lo que incluye cada plan, tal como lo ve el Propietario en «Mejora
 * tu plan». Vale para todas las empresas; lo que se deja en blanco vuelve al
 * valor de fábrica. Los topes reales de cada empresa se fijan en su ficha.
 */

type Data = { catalog: PlanCatalog; defaults: PlanCatalog };

const num = (s: string): number | null => (s.trim() === "" ? null : Number(s.replace(/[,\s$]/g, "")));

type Form = ReturnType<typeof toForm>;

/** Un plan como tarjeta: nombre, frase, precios, implementación y lo que incluye. */
function PlanCard({ scope, base, f, setF }: { scope: CatalogScope; base: PlanCatalogEntry; f: Form; setF: (f: Form) => void }) {
  const field = (id: keyof Form & string, label: string, placeholder: string, hint?: string) => (
    <div className="min-w-0 space-y-1">
      <Label className="text-sm" htmlFor={`plan-${scope}-${id}`}>{label}</Label>
      <Input
        id={`plan-${scope}-${id}`}
        inputMode={id === "name" || id === "tagline" ? "text" : "numeric"}
        value={f[id] as string}
        placeholder={placeholder}
        onChange={(e) => setF({ ...f, [id]: e.target.value })}
        data-testid={`platform-plan-${scope}-${id}`}
      />
      {hint && <p className="text-[11px] text-text-3">{hint}</p>}
    </div>
  );
  return (
    <li
      className={`space-y-3 rounded-xl border bg-card p-5 ${f.recommended ? "border-brand ring-1 ring-brand/30" : ""}`}
      data-testid={`platform-plan-${scope}`}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold">{f.name || base.name}</h3>
        {f.recommended && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-text">Más elegido</span>}
      </div>
      {field("name", "Nombre", base.name)}
      {field("tagline", "Descripción corta", base.tagline)}
      <div className="grid grid-cols-2 gap-3">
        {field("monthly", "Mensual (MXN + IVA)", String(base.priceMonthlyMxn))}
        {field("yearly", "Anual", "10 mensualidades", "Vacío = 2 meses gratis.")}
      </div>
      {field("fee", "Implementación (una vez)", String(base.implementationFeeMxn), "0 = sin cuota.")}
      <div className="grid grid-cols-2 gap-3">
        {field("people", "Personas", String(base.peopleLimit))}
        {field("storage", "Almacenamiento (GB)", String(base.storageGb))}
      </div>
      <div className="space-y-1">
        <Label className="text-sm" htmlFor={`plan-${scope}-features`}>Qué incluye (una línea por viñeta, máximo 8)</Label>
        <Textarea id={`plan-${scope}-features`} rows={6} value={f.features} onChange={(e) => setF({ ...f, features: e.target.value })} data-testid={`platform-plan-${scope}-features`} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.recommended} onChange={(e) => setF({ ...f, recommended: e.target.checked })} data-testid={`platform-plan-${scope}-recommended`} />
        Marcar como «Más elegido» (solo uno a la vez)
      </label>
    </li>
  );
}

function toForm(e: PlanCatalogEntry) {
  return {
    name: e.name,
    tagline: e.tagline,
    monthly: String(e.priceMonthlyMxn),
    yearly: e.priceYearlyMxn === null ? "" : String(e.priceYearlyMxn),
    fee: String(e.implementationFeeMxn),
    people: String(e.peopleLimit),
    storage: String(e.storageGb),
    features: e.features.join("\n"),
    recommended: e.recommended,
  };
}

export function PlanCatalogCard() {
  const [data, setData] = useState<Data | null>(null);
  const [forms, setForms] = useState<Record<string, Form> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const r = await api<Data>("/api/platform/plans");
    if (r.ok && r.data) {
      setData(r.data);
      setForms(Object.fromEntries(CATALOG_SCOPES.map((k) => [k, toForm(r.data!.catalog[k])])));
    } else setError(r.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  function parse(f: Form) {
    const monthly = num(f.monthly);
    const yearly = num(f.yearly);
    const fee = num(f.fee);
    const people = num(f.people);
    const storage = num(f.storage);
    for (const [label, v] of [["Precio mensual", monthly], ["Precio anual", yearly], ["Implementación", fee], ["Personas", people], ["Almacenamiento", storage]] as const) {
      if (v !== null && (!Number.isFinite(v) || v < 0 || !Number.isInteger(v))) return `${label}: escribe un número entero (o déjalo vacío para el valor de fábrica).`;
    }
    return {
      name: f.name.trim() || null,
      tagline: f.tagline.trim() || null,
      priceMonthlyMxn: monthly,
      priceYearlyMxn: yearly,
      implementationFeeMxn: fee,
      peopleLimit: people,
      storageGb: storage,
      features: f.features.split("\n").map((l) => l.trim()).filter(Boolean),
      recommended: f.recommended,
    };
  }

  async function saveAll() {
    if (!forms) return;
    setSaved(false);
    let last: Data | null = null;
    for (const scope of CATALOG_SCOPES) {
      const body = parse(forms[scope]!);
      if (typeof body === "string") return setError(`${scope}: ${body}`);
      const r = await api<Data>("/api/platform/plans", { method: "PUT", body: JSON.stringify({ scope, ...body }) });
      if (!r.ok || !r.data) return setError(r.error ?? "No se pudo guardar.");
      last = r.data;
    }
    setError(null);
    if (last) {
      setData(last);
      setForms(Object.fromEntries(CATALOG_SCOPES.map((k) => [k, toForm(last!.catalog[k])])));
    }
    setSaved(true);
  }

  return (
    <div className="space-y-4" data-testid="platform-plans">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-2">
          Lo que el Propietario ve en «Mejora tu plan». Precios en pesos + IVA · anual = 10 meses (2 gratis). Los topes de cada empresa se fijan en su ficha.
        </p>
        <div className="flex items-center gap-3">
          {error && <span className="text-sm text-destructive">{error}</span>}
          {saved && !error && <span className="text-sm text-text-2">Guardado</span>}
          <Button onClick={() => void saveAll()} disabled={!forms} data-testid="platform-plans-save">
            Guardar cambios
          </Button>
        </div>
      </div>
      {!data || !forms ? (
        <p className={error ? "text-sm text-destructive" : "text-sm text-text-2"}>{error ?? "Cargando…"}</p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-3">
          {CATALOG_SCOPES.map((scope) => (
            <PlanCard key={scope} scope={scope} base={data.defaults[scope]} f={forms[scope]!} setF={(f) => setForms({ ...forms, [scope]: f })} />
          ))}
        </ul>
      )}
    </div>
  );
}
