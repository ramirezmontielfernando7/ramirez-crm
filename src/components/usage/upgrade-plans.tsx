"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { formatMxn, freeMonths, yearlyPrice, type CatalogScope, type PlanCatalog, type PlanCatalogEntry } from "@/lib/plan-catalog";
import type { PlanKey } from "@/lib/limits";
import { cn } from "@/lib/utils";

/**
 * «Mejora tu plan»: los tres planes del catálogo (precios que fija la
 * plataforma, en pesos más IVA) con el actual marcado. Sin cobro real: «Elegir»
 * avisa a la plataforma (`POST /api/usage/plan-request`) y se le contacta.
 */
type PlansResponse = { current: PlanKey; catalog: PlanCatalog };

function Card({
  plan,
  current,
  yearly,
  sent,
  busy,
  onChoose,
}: {
  plan: PlanCatalogEntry;
  current: boolean;
  yearly: boolean;
  sent: boolean;
  busy: boolean;
  onChoose: () => void;
}) {
  const price = yearly ? yearlyPrice(plan) : plan.priceMonthlyMxn;
  return (
    <div
      className={cn("usage-plan flex min-w-0 flex-1 flex-col gap-2 rounded-2xl border bg-card p-5", plan.recommended && "usage-plan-rec")}
      data-testid={`upgrade-plan-${plan.scope}`}
    >
      <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
        {plan.name}
        {current && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-text-2">Tu plan</span>}
        {plan.recommended && !current && <span className="usage-plan-badge rounded-md px-1.5 py-0.5 text-[11px] font-medium">Recomendado</span>}
      </h3>
      <p className="text-3xl font-semibold tracking-tight" data-testid={`upgrade-plan-${plan.scope}-price`}>
        {formatMxn(price)}
        <span className="ml-1 text-xs font-normal text-text-2">MXN / {yearly ? "año" : "mes"}</span>
      </p>
      <p className="min-h-[2.5rem] text-sm text-text-2">
        {plan.tagline}
        {yearly && freeMonths(plan) > 0 && <span className="block text-xs text-brand-text">{freeMonths(plan)} meses gratis</span>}
      </p>
      {current ? (
        <span className="rounded-lg border px-3 py-2 text-center text-sm text-text-3">Plan actual</span>
      ) : (
        <button
          type="button"
          disabled={busy || sent}
          onClick={onChoose}
          data-testid={`upgrade-plan-${plan.scope}-choose`}
          className={cn(
            "rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60",
            plan.recommended ? "usage-btn-dark" : "border bg-card hover:bg-accent"
          )}
        >
          {sent ? "Solicitud enviada" : `Elegir ${plan.name}`}
        </button>
      )}
      <ul className="mt-2 grid gap-1.5 text-[13px]">
        <li className="flex gap-2">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
          {plan.peopleLimit} personas del equipo
        </li>
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
            {f}
          </li>
        ))}
      </ul>
      {plan.implementationFeeMxn > 0 && (
        <p className="mt-1 text-[11px] text-text-3">
          Implementación única: {formatMxn(plan.implementationFeeMxn)}
          {yearly ? " (sin cuota con el plan anual)" : ""}.
        </p>
      )}
    </div>
  );
}

export function UpgradePlans() {
  const [data, setData] = useState<PlansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yearly, setYearly] = useState(false);
  const [sent, setSent] = useState<CatalogScope | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivo = true;
    void fetchJson<PlansResponse>("/api/usage/plans").then((r) => {
      if (!vivo) return;
      if (r.ok) setData(r.data);
      else setError(r.error);
    });
    return () => {
      vivo = false;
    };
  }, []);

  async function choose(plan: CatalogScope) {
    setBusy(true);
    const r = await fetchJson("/api/usage/plan-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, billing: yearly ? "yearly" : "monthly" }) });
    setBusy(false);
    if (r.ok) {
      setSent(plan);
      setError(null);
    } else setError(r.error);
  }

  if (!data) return <p className={cn("text-sm", error ? "text-destructive" : "text-text-2")}>{error ?? "Cargando planes…"}</p>;
  const plans = Object.values(data.catalog);
  return (
    <div data-testid="upgrade-plans">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-2">Precios en pesos más IVA. Cancelas cuando quieras.</p>
        <div className="inline-flex rounded-lg bg-muted p-0.5 text-[13px]" role="group" aria-label="Periodo de cobro">
          <button type="button" onClick={() => setYearly(false)} aria-pressed={!yearly} className={cn("rounded-md px-3 py-1", !yearly && "bg-card font-medium shadow-sm")}>
            Mensual
          </button>
          <button type="button" onClick={() => setYearly(true)} aria-pressed={yearly} data-testid="upgrade-yearly" className={cn("rounded-md px-3 py-1", yearly && "bg-card font-medium shadow-sm")}>
            Anual · 2 meses gratis
          </button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.scope} plan={p} current={data.current === p.scope} yearly={yearly} sent={sent === p.scope} busy={busy} onChoose={() => void choose(p.scope)} />
        ))}
      </div>
      {sent && (
        <p className="mt-4 rounded-lg bg-brand-tint px-3 py-2 text-sm text-brand-text" role="status" data-testid="upgrade-sent">
          Recibimos tu solicitud del plan {data.catalog[sent].name}. Te contactamos para activarlo.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <p className="mt-4 text-xs text-text-3">¿Necesitas algo distinto? Escríbenos y armamos un plan a tu medida.</p>
    </div>
  );
}
