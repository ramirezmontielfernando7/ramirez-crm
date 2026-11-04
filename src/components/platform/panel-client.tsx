"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { creditsPace, formatUsd2 } from "@/lib/ai-plans";
import { PLAN_LABEL } from "@/lib/limits";
import { aiUsdRows, buildPanel } from "@/lib/platform-panel";
import { cn } from "@/lib/utils";
import type { AiSettingsOverview } from "@/server/ai-settings/admin";
import { api, mesDe, type Org } from "./api";

/**
 * 036 (PR 5) · 0070 — «Mi panel»: la plataforma de un vistazo, sencillo
 * (maqueta 3): la IA del mes en dólares contra el presupuesto, empresas
 * activas, cuántas van cerca de su tope y el consumo de IA de cada empresa en
 * porcentaje. Solo metadatos y números.
 */

const SHOWN = 5;

/** Primer día del mes siguiente (UTC): «1 de diciembre». */
function renewal(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toLocaleDateString("es-MX", { day: "numeric", month: "long", timeZone: "UTC" });
}

const usd = (n: number) => formatUsd2(n).replace(" USD", "");

function Bar({ ratio, testId }: { ratio: number | null; testId?: string }) {
  const pct = ratio === null ? 0 : Math.min(100, Math.round(ratio * 100));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" data-testid={testId}>
      <div
        className={cn("h-full rounded-full", ratio !== null && ratio >= 1 ? "bg-destructive" : ratio !== null && ratio >= 0.8 ? "bg-warning" : "bg-brand")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function PanelClient() {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [overview, setOverview] = useState<AiSettingsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ organizations: Org[] }>("/api/platform/organizations").then((r) => {
      if (r.data) setOrgs(r.data.organizations);
      else setError(r.error);
    });
    void api<AiSettingsOverview>("/api/platform/ai-settings").then((r) => r.data && setOverview(r.data));
  }, []);

  if (error) return <p className="p-6 text-sm text-danger-text">{error}</p>;
  if (!orgs) return <p className="p-6 text-sm text-text-2">Cargando…</p>;

  const p = buildPanel(orgs);
  const { rows, nearCap } = aiUsdRows(orgs);
  const period = orgs.find((o) => o.usage)?.usage?.period;
  const b = overview?.budget;
  const spent = b?.spentThisMonth ?? rows.reduce((n, r) => n + r.estUsd, 0);
  const pace = b ? creditsPace({ budgetUsd: b.monthlyUsd, creditsUsd: b.creditsUsd, spentSinceCredits: b.spentSinceCredits, spentThisMonth: b.spentThisMonth, now: new Date() }) : null;
  const ratio = pace?.ratio ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6" data-testid="platform-panel">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="space-y-2 pt-5" data-testid="panel-ai">
            <p className="text-sm text-text-2">IA de este mes{period ? ` (${mesDe(period)})` : ""}</p>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-2xl font-semibold">{formatUsd2(spent)}</p>
              {b?.monthlyUsd ? (
                <p className="text-sm text-text-2">
                  de {usd(b.monthlyUsd)} USD · {Math.round((ratio ?? 0) * 100)} %
                </p>
              ) : (
                <Link href="/platform/costos" className="text-sm text-brand-text hover:underline">
                  Pon un presupuesto
                </Link>
              )}
            </div>
            {ratio !== null && <Bar ratio={ratio} />}
            <p className="text-xs text-text-3">
              {pace?.remainingUsd !== null && pace?.remainingUsd !== undefined
                ? `Se paga con créditos de AWS · quedan ${usd(pace.remainingUsd)} USD`
                : "Costo estimado con el precio de cada modelo"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-5" data-testid="panel-orgs">
            <p className="text-sm text-text-2">Empresas activas</p>
            <p className="text-2xl font-semibold">{p.byStatus.active}</p>
            <p className="text-xs text-text-3">
              {p.byStatus.suspended === 1 ? "1 suspendida" : `${p.byStatus.suspended} suspendidas`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-5" data-testid="panel-near">
            <p className="text-sm text-text-2">Cerca de su tope</p>
            <p className="text-2xl font-semibold">{nearCap}</p>
            <p className="text-xs text-text-3">Con 80 % o más de su IA</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Consumo de IA por empresa</h2>
            <span className="text-xs text-text-3">Se renueva el {renewal()}</span>
          </div>
          <ul className="divide-y" data-testid="panel-ai-list">
            {rows.length === 0 && <li className="py-3 text-sm text-text-2">Sin empresas activas.</li>}
            {rows.slice(0, SHOWN).map((r) => (
              <li key={r.id}>
                <Link
                  href={`/platform/organizaciones/${r.id}`}
                  className="grid items-center gap-x-4 gap-y-1 py-3 hover:bg-muted/40 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_4rem_minmax(0,8rem)_1rem]"
                  data-testid="panel-ai-row"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{r.name}</span>
                    <span className="block text-xs text-text-3">{r.planKey && r.planKey in PLAN_LABEL ? PLAN_LABEL[r.planKey as keyof typeof PLAN_LABEL] : "Sin plan"}</span>
                  </span>
                  <Bar ratio={r.ratio} />
                  <span className="text-right text-sm font-medium tabular-nums">{r.ratio === null ? "—" : `${Math.round(r.ratio * 100)} %`}</span>
                  <span className="text-right text-xs text-text-2 tabular-nums">
                    {r.usdLimit === null ? `${usd(r.estUsd)} USD · sin tope` : `${usd(r.estUsd)} de ${usd(r.usdLimit)} USD`}
                  </span>
                  <ChevronRight className="hidden h-4 w-4 text-text-3 sm:block" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          {rows.length > SHOWN && (
            <Link href="/platform/organizaciones" className="mt-2 inline-block text-sm text-brand-text hover:underline" data-testid="panel-ai-all">
              Ver las {rows.length} empresas
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
