"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildPanel } from "@/lib/platform-panel";
import { formatStorage, formatTokens, STORAGE_LABEL, turnos } from "@/lib/usage";
import { ACTION_LABEL } from "./audit-log";
import { api, fecha, mesDe, type AuditEntry, type Org } from "./api";

function Stat({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-5" data-testid={testId}>
        <p className="text-sm text-text-2">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
        {hint && <p className="text-xs text-text-3">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** 036 (PR 5) — «Mi panel»: la plataforma de un vistazo (solo metadatos y números). */
export function PanelClient() {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ organizations: Org[] }>("/api/platform/organizations").then((r) => {
      if (r.data) setOrgs(r.data.organizations);
      else setError(r.error);
    });
    void api<{ entries: AuditEntry[] }>("/api/platform/audit").then((r) => setAudit((r.data?.entries ?? []).slice(0, 8)));
  }, []);

  if (error) return <p className="p-6 text-sm text-danger-text">{error}</p>;
  if (!orgs) return <p className="p-6 text-sm text-text-2">Cargando…</p>;

  const p = buildPanel(orgs);
  const period = orgs.find((o) => o.usage)?.usage?.period;
  const aiHint =
    p.ai.assignedTokens !== null
      ? `de ${formatTokens(p.ai.assignedTokens)} asignados${p.ai.withoutLimit ? ` · ${p.ai.withoutLimit} sin tope` : ""}`
      : "sin topes asignados";

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6" data-testid="platform-panel">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Organizaciones activas"
          value={String(p.byStatus.active)}
          hint={`${p.byStatus.suspended} suspendidas · ${p.byStatus.deleted} borradas`}
          testId="panel-orgs"
        />
        <Stat
          label={`IA del mes${period ? ` (${mesDe(period)})` : ""}`}
          value={`${formatTokens(p.ai.tokens)} tokens`}
          hint={`${turnos(p.ai.turns)} · ${aiHint}`}
          testId="panel-ai"
        />
        <Stat label={STORAGE_LABEL} value={formatStorage(p.storageBytes)} hint="Suma de las organizaciones activas" testId="panel-storage" />
        <Stat
          label="Cerca de un tope"
          value={String(new Set(p.nearLimit.map((n) => n.id)).size)}
          hint="Con 80 % o más de IA o almacenamiento"
          testId="panel-near"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cerca del tope</CardTitle>
            <CardDescription>Organizaciones con 80 % o más de un tope este mes.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm" data-testid="panel-near-list">
              {p.nearLimit.length === 0 && <li className="text-text-2">Ninguna por ahora.</li>}
              {p.nearLimit.map((n) => (
                <li key={n.id + n.kind} className="flex items-center justify-between gap-2">
                  <Link href={`/platform/organizaciones/${n.id}`} className="font-medium hover:underline">
                    {n.name}
                  </Link>
                  <span className="flex items-center gap-2 text-text-2" title={n.meter.detail}>
                    {n.kind === "ia" ? "IA" : "Almacenamiento"} · {n.meter.text}
                    <Badge variant={n.meter.tone === "danger" ? "destructive" : "warning"}>
                      {Math.round((n.meter.ratio ?? 0) * 100)} %
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quién consume más IA</CardTitle>
            <CardDescription>Las cinco organizaciones con más tokens este mes.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm" data-testid="panel-top">
              {p.topAi.length === 0 && <li className="text-text-2">Sin consumo todavía.</li>}
              {p.topAi.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2">
                  <Link href={`/platform/organizaciones/${t.id}`} className="font-medium hover:underline">
                    {t.name}
                  </Link>
                  <span className="text-text-2">
                    {formatTokens(t.tokens)} tokens · {turnos(t.turns)}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bitácora reciente</CardTitle>
          <CardDescription>
            Lo último que se hizo en la plataforma. <Link href="/platform/admin" className="underline">Ver todo</Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-sm" data-testid="panel-audit">
            {audit.length === 0 && <li className="text-text-2">Sin registros todavía.</li>}
            {audit.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2 break-words">
                <span className="text-text-2">{fecha(e.at)}</span>
                <span className="font-medium">{e.actorEmail ?? "—"}</span>
                <span>{ACTION_LABEL[e.action] ?? e.action}</span>
                {e.targetOrgName && <span>· {e.targetOrgName}</span>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
