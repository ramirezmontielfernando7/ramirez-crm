"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CATALOG_SCOPES, formatMxn, freeMonths, yearlyPrice, type CatalogScope, type PlanCatalog, type PlanCatalogEntry } from "@/lib/plan-catalog";
import { api } from "./api";

/**
 * Plataforma → Organizaciones y Planes → «Planes y precios»: nombre, precio en
 * pesos y lo que incluye cada plan, tal como lo ve el Propietario en «Mejora
 * tu plan». Vale para todas las empresas; lo que se deja en blanco vuelve al
 * valor de fábrica. Los topes reales de cada empresa se fijan en su ficha.
 */

type Data = { catalog: PlanCatalog; defaults: PlanCatalog };

const num = (s: string): number | null => (s.trim() === "" ? null : Number(s.replace(/[,\s$]/g, "")));

function PlanRow({ scope, data, onSaved }: { scope: CatalogScope; data: Data; onSaved: (d: Data) => void }) {
  const row = data.catalog[scope];
  const base = data.defaults[scope];
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(() => toForm(row));

  useEffect(() => setF(toForm(row)), [row]);

  async function send(body: Record<string, unknown>) {
    const r = await api<Data>("/api/platform/plans", { method: "PUT", body: JSON.stringify({ scope, ...body }) });
    if (!r.ok || !r.data) return setError(r.error ?? "No se pudo guardar.");
    setError(null);
    setOpen(false);
    onSaved(r.data);
  }

  async function save() {
    const monthly = num(f.monthly);
    const yearly = num(f.yearly);
    const fee = num(f.fee);
    const people = num(f.people);
    const storage = num(f.storage);
    for (const [label, v] of [["Precio mensual", monthly], ["Precio anual", yearly], ["Implementación", fee], ["Personas", people], ["Almacenamiento", storage]] as const) {
      if (v !== null && (!Number.isFinite(v) || v < 0 || !Number.isInteger(v))) return setError(`${label}: escribe un número entero (o déjalo vacío para el valor de fábrica).`);
    }
    await send({
      name: f.name.trim() || null,
      tagline: f.tagline.trim() || null,
      priceMonthlyMxn: monthly,
      priceYearlyMxn: yearly,
      implementationFeeMxn: fee,
      peopleLimit: people,
      storageGb: storage,
      features: f.features.split("\n").map((l) => l.trim()).filter(Boolean),
      recommended: f.recommended,
    });
  }

  const field = (id: string, label: string, value: string, onChange: (v: string) => void, placeholder: string, hint?: string) => (
    <div className="space-y-1">
      <Label className="text-xs" htmlFor={`plan-${scope}-${id}`}>{label}</Label>
      <Input id={`plan-${scope}-${id}`} inputMode={id === "name" || id === "tagline" ? "text" : "numeric"} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={`platform-plan-${scope}-${id}`} />
      {hint && <p className="text-[11px] text-text-3">{hint}</p>}
    </div>
  );

  return (
    <li className="py-3" data-testid={`platform-plan-${scope}`}>
      <div className="grid grid-cols-2 items-center gap-x-4 gap-y-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <span className="text-sm font-medium">
          {row.name}
          {row.recommended && <span className="ml-2 rounded-md bg-brand-tint px-1.5 py-0.5 text-[11px] font-medium text-brand-text">Recomendado</span>}
        </span>
        <span className="text-sm tabular-nums" data-testid={`platform-plan-${scope}-price`}>{formatMxn(row.priceMonthlyMxn)} / mes</span>
        <span className="text-sm tabular-nums text-text-2">{formatMxn(yearlyPrice(row))} / año ({freeMonths(row)} meses gratis)</span>
        <span className="text-sm text-text-2">{row.peopleLimit} personas · {row.storageGb} GB</span>
        <Button size="sm" variant="ghost" className="justify-self-end text-brand-text" onClick={() => setOpen((o) => !o)} data-testid={`platform-plan-${scope}-edit`}>
          {open ? "Cerrar" : "Editar"}
        </Button>
      </div>
      {open && (
        <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {field("name", "Nombre", f.name, (v) => setF({ ...f, name: v }), base.name)}
            {field("tagline", "Frase corta", f.tagline, (v) => setF({ ...f, tagline: v }), base.tagline)}
            {field("monthly", "Precio mensual (MXN + IVA)", f.monthly, (v) => setF({ ...f, monthly: v }), String(base.priceMonthlyMxn))}
            {field("yearly", "Precio anual (MXN + IVA)", f.yearly, (v) => setF({ ...f, yearly: v }), "10 mensualidades", "Vacío = «2 meses gratis» (10 mensualidades).")}
            {field("fee", "Cuota de implementación (MXN, una vez)", f.fee, (v) => setF({ ...f, fee: v }), String(base.implementationFeeMxn), "0 = sin cuota.")}
            {field("people", "Personas del equipo", f.people, (v) => setF({ ...f, people: v }), String(base.peopleLimit))}
            {field("storage", "Almacenamiento (GB)", f.storage, (v) => setF({ ...f, storage: v }), String(base.storageGb))}
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor={`plan-${scope}-features`}>Qué incluye (una línea por viñeta, máximo 8)</Label>
            <Textarea id={`plan-${scope}-features`} rows={5} value={f.features} onChange={(e) => setF({ ...f, features: e.target.value })} data-testid={`platform-plan-${scope}-features`} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.recommended} onChange={(e) => setF({ ...f, recommended: e.target.checked })} data-testid={`platform-plan-${scope}-recommended`} />
            Marcar como «Recomendado» (solo uno a la vez)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void save()} data-testid={`platform-plan-${scope}-save`}>Guardar plan {row.name}</Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void send({ name: null, tagline: null, priceMonthlyMxn: null, priceYearlyMxn: null, implementationFeeMxn: null, peopleLimit: null, storageGb: null, features: null, recommended: null })
              }
              data-testid={`platform-plan-${scope}-reset`}
            >
              Volver a los valores de fábrica
            </Button>
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </div>
      )}
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
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<Data>("/api/platform/plans");
    if (r.ok && r.data) setData(r.data);
    else setError(r.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card data-testid="platform-plans">
      <CardHeader>
        <CardTitle>Planes y precios</CardTitle>
        <CardDescription>
          Lo que el Propietario ve en «Mejora tu plan». Precios en pesos más IVA. Los topes reales de cada empresa (personas, almacenamiento, IA) se fijan en su ficha.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!data ? (
          <p className={error ? "text-sm text-destructive" : "text-sm text-text-2"}>{error ?? "Cargando…"}</p>
        ) : (
          <ul className="divide-y">
            {CATALOG_SCOPES.map((scope) => (
              <PlanRow key={scope} scope={scope} data={data} onSaved={setData} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
