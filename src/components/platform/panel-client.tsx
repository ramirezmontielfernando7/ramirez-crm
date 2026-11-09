"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { creditsPace, formatUsd2, monthFraction } from "@/lib/ai-plans";
import { PLAN_LABEL } from "@/lib/limits";
import { aiUsdRows, buildPanel } from "@/lib/platform-panel";
import { cn } from "@/lib/utils";
import type { AiSettingsOverview } from "@/server/ai-settings/admin";
import { ACTION_LABEL } from "./audit-log";
import { api, fecha, mesDe, type AuditEntry, type Org } from "./api";

/**
 * 036 (PR 5) · 0070 — «Mi panel»: la plataforma de un vistazo, sencillo
 * (maqueta 3): la IA del mes en dólares contra el presupuesto, empresas
 * activas, cuántas van cerca de su tope y el consumo de IA de cada empresa en
 * porcentaje. Solo metadatos y números.
 */

const SHOWN = 5;

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
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ organizations: Org[] }>("/api/platform/organizations").then((r) => {
      if (r.data) setOrgs(r.data.organizations);
      else setError(r.error);
    });
    void api<{ entries: AuditEntry[] }>("/api/platform/audit").then((a) => setAudit(a.data?.entries ?? []));
    void api<AiSettingsOverview>("/api/platform/ai-settings").then((r) => r.data && setOverview(r.data));
  }, []);

  if (error) return <p className="p-6 text-sm text-danger-text">{error}</p>;
  if (!orgs) return <p className="p-6 text-sm text-text-2">Cargando…</p>;

  const p = buildPanel(orgs);
  const { rows } = aiUsdRows(orgs);
  const period = orgs.find((o) => o.usage)?.usage?.period;
  const b = overview?.budget;
  const spent = b?.spentThisMonth ?? rows.reduce((n, r) => n + r.estUsd, 0);
  const pace = b ? creditsPace({ budgetUsd: b.monthlyUsd, creditsUsd: b.creditsUsd, spentSinceCredits: b.spentSinceCredits, spentThisMonth: b.spentThisMonth, now: new Date() }) : null;
  const ratio = pace?.ratio ?? null;

  const monthly = overview?.budget;
  const projected = spent / Math.max(monthFraction(new Date()), 1 / 31);
  const requests = (audit ?? []).filter((e) => e.action === "plan.requested" && Date.now() - new Date(e.at).getTime() < 30 * 86400_000).length;
  const trouble = rows.filter((r) => r.ratio !== null && r.ratio >= 0.8);
  const near = (trouble.length > 0 ? trouble : rows).slice(0, SHOWN);
  const months = pace?.remainingUsd !== null && pace?.remainingUsd !== undefined && b?.monthlyUsd ? Math.floor(pace.remainingUsd / b.monthlyUsd) : null;

  return (
    <div className="space-y-4 p-4 sm:p-6" data-testid="platform-panel">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="space-y-1 pt-5" data-testid="panel-orgs">
            <p className="text-sm text-text-2">Empresas activas</p>
            <p className="text-3xl font-semibold tabular-nums">{p.byStatus.active}</p>
            <p className="text-xs text-text-3">{p.byStatus.suspended === 1 ? "1 suspendida" : `${p.byStatus.suspended} suspendidas`}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-5" data-testid="panel-ai">
            <p className="text-sm text-text-2">Costo de IA del mes{period ? ` (${mesDe(period)})` : ""}</p>
            <p className="text-3xl font-semibold tabular-nums">{formatUsd2(spent)}</p>
            <p className="text-xs text-text-3">{spent > 0 ? `Proyección: ${formatUsd2(projected)}` : "Costo estimado con el precio de cada modelo"}</p>
            {monthly?.monthlyUsd ? <Bar ratio={ratio} /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-5" data-testid="panel-credits">
            <p className="text-sm text-text-2">Créditos AWS</p>
            <p className="text-3xl font-semibold tabular-nums">{pace?.remainingUsd !== null && pace?.remainingUsd !== undefined ? formatUsd2(pace.remainingUsd) : "—"}</p>
            <p className="text-xs text-text-3">{months !== null ? `Alcanzan ~${months} meses` : "Captura tus créditos en IA: modelos y costos"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 pt-5" data-testid="panel-requests">
            <p className="text-sm text-text-2">Solicitudes de plan</p>
            <p className="text-3xl font-semibold tabular-nums">{audit === null ? "…" : requests}</p>
            <p className="text-xs text-text-3">En los últimos 30 días</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="p-0" data-testid="panel-near">
            <div className="flex items-baseline justify-between gap-2 border-b px-5 py-4">
              <h2 className="text-sm font-semibold">{trouble.length > 0 ? "Empresas cerca de su tope de IA" : "Consumo de IA por empresa"}</h2>
              <Link href="/platform/organizaciones" className="text-sm text-brand-text hover:underline" data-testid="panel-ai-all">
                Ver todas
              </Link>
            </div>
            <ul className="divide-y" data-testid="panel-ai-list">
              {near.length === 0 && <li className="px-5 py-4 text-sm text-text-2">Sin empresas activas.</li>}
              {near.map((r) => {
                const plan = r.planKey && r.planKey in PLAN_LABEL ? PLAN_LABEL[r.planKey as keyof typeof PLAN_LABEL] : "Sin plan";
                return (
                  <li key={r.id}>
                    <Link
                      href={`/platform/organizaciones/${r.id}`}
                      className="grid items-center gap-x-4 gap-y-1 px-5 py-3.5 hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_5rem_minmax(0,9rem)_3rem]"
                      data-testid="panel-ai-row"
                    >
                      <span className="truncate text-sm font-medium">{r.name}</span>
                      <PlanPill label={plan} />
                      {r.ratio === null ? <span className="text-xs text-text-3">{r.usdLimit === null ? "Sin tope" : "—"}</span> : <Bar ratio={r.ratio} />}
                      <span className="text-right text-sm font-medium tabular-nums">{r.ratio === null ? "" : `${Math.round(r.ratio * 100)} %`}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-0" data-testid="panel-activity">
            <div className="border-b px-5 py-4">
              <h2 className="text-sm font-semibold">Actividad reciente</h2>
            </div>
            <ul className="space-y-3 px-5 py-4">
              {audit === null && <li className="text-sm text-text-2">Cargando…</li>}
              {audit?.length === 0 && <li className="text-sm text-text-2">Sin movimientos todavía.</li>}
              {audit?.slice(0, 5).map((e) => (
                <li key={e.id} className="text-sm">
                  <p className="break-words">
                    {e.targetOrgName ? <span className="font-medium">{e.targetOrgName}: </span> : null}
                    {ACTION_LABEL[e.action] ?? e.action}
                  </p>
                  <p className="text-xs text-text-3">{fecha(e.at)}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** La píldora de plan de las tablas de Plataforma. */
export function PlanPill({ label }: { label: string }) {
  const tone =
    label === "Ultra" ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" : label === "Pro" ? "bg-brand-soft text-brand-text" : label === "Personalizado" ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" : "bg-muted text-text-2";
  return <span className={cn("inline-block w-fit rounded-full px-2 py-0.5 text-xs font-medium", tone)}>{label}</span>;
}
