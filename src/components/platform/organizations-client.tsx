"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PLAN_KEYS, PLAN_LABEL } from "@/lib/limits";
import { countActiveModules } from "@/lib/platform-modules";
import {
  countByStatus,
  filterOrgs,
  ORG_STATUS_FILTER_LABEL,
  ORG_STATUS_FILTERS,
  orgPlanKey,
  type OrgPlanFilter,
  type OrgStatusFilter,
} from "@/lib/platform-orgs";
import { aiMeter, STORAGE_LABEL, storageMeter } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { api, type Org } from "./api";
import { CreateOrganization } from "./create-organization";
import { UsageMeter } from "./usage";

/**
 * 040 — Plataforma → Organizaciones y Planes. Tabla ejecutiva: nombre,
 * estado, plan guardado (Esencial / Pro / Ultra / Personalizado), módulos
 * «x/13», IA del mes y almacenamiento aproximado, con filtros rápidos por
 * estado y por plan. Cada fila abre la ficha de la organización
 * (`/platform/organizaciones/[id]`), organizada en pestañas. Solo metadatos y
 * números: el contenido de cada negocio no se ve desde aquí.
 */

export const STATUS_LABEL: Record<Org["status"], string> = {
  active: "Activa",
  suspended: "Suspendida",
  deleted: "Borrada",
};

export const STATUS_DOT: Record<Org["status"], string> = {
  active: "bg-success",
  suspended: "bg-warning",
  deleted: "bg-destructive",
};

const GRID = "sm:grid-cols-[minmax(0,1.6fr)_7rem_4.5rem_minmax(0,1.2fr)_minmax(0,1fr)_6rem_4.5rem]";

const STATUS_PILL: Record<Org["status"], string> = {
  active: "bg-success-tint text-success-text",
  suspended: "bg-warning-tint text-warning-text",
  deleted: "bg-danger-tint text-danger-text",
};
const PLAN_PILL: Record<string, string> = {
  ultra: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  pro: "bg-brand-soft text-brand-text",
  custom: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
};
const iniciales = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

function Chip({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "h-8 shrink-0 rounded-md border px-2.5 text-[13px] font-medium transition-colors",
        active ? "border-brand bg-brand-tint text-brand-text" : "bg-card text-text-2 hover:bg-accent hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function OrganizationRow({ org }: { org: Org }) {
  const ai = org.usage ? aiMeter(org.usage.ai, org.usage.ai.limits) : null;
  const storage = org.usage ? storageMeter(org.usage.storageBytes, org.usage.plan.storageLimitBytes) : null;
  const avisoMax = Math.max(0, ...(org.usage?.alerts ?? []).map((a) => a.threshold));
  const { active, total } = countActiveModules(org.modules);
  const tope = org.usage?.plan.maxModules ?? null;
  const plan = orgPlanKey(org);
  return (
    <li data-testid={`platform-org-${org.id}`}>
      <Link
        href={`/platform/organizaciones/${org.id}`}
        className={cn(
          "grid grid-cols-2 items-center gap-x-4 gap-y-2 px-3 py-3.5 transition-colors hover:bg-accent sm:gap-x-5 sm:px-4",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          GRID
        )}
        data-testid="platform-org-open"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-xs font-semibold text-brand-text" aria-hidden>
            {iniciales(org.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{org.name}</span>
            <span className="block truncate text-xs text-text-3">
              {org.isPlatform ? "Plataforma · " : ""}
              {org.members} persona(s)
              {org.usage?.plan.maxMembers != null && ` de ${org.usage.plan.maxMembers}`}
            </span>
          </span>
          {avisoMax > 0 && (
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 text-[10px] font-semibold leading-4",
                avisoMax >= 100 ? "bg-danger-tint text-danger-text" : "bg-warning-tint text-warning-text"
              )}
              title="Tiene avisos de consumo este mes"
              data-testid="platform-org-alert"
            >
              {avisoMax} %
            </span>
          )}
        </span>
        <span>
          <span
            className={cn("rounded-full px-2 py-0.5 text-xs font-medium", PLAN_PILL[plan] ?? "bg-muted text-text-2")}
            data-testid="platform-org-plan"
            data-plan={plan}
          >
            {PLAN_LABEL[plan]}
          </span>
        </span>
        <span
          className={cn("text-sm tabular-nums text-text-2", tope !== null && active > tope && "text-warning-text")}
          title={`${active} de ${total} módulos activos${tope !== null ? ` · tope ${tope}` : ""}`}
          data-testid="platform-org-modules-count"
        >
          {active}/{total}
        </span>
        {ai ? <UsageMeter meter={ai} label="IA del mes" testId="platform-org-ai" /> : <span className="text-text-3">—</span>}
        {storage ? <UsageMeter meter={storage} label={STORAGE_LABEL} testId="platform-org-storage" /> : <span />}
        <span>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_PILL[org.status])} data-testid="platform-org-status">
            {STATUS_LABEL[org.status]}
          </span>
        </span>
        <span className="hidden justify-self-end rounded-md border px-3 py-1 text-sm font-medium sm:inline-block">Abrir</span>
      </Link>
    </li>
  );
}

export function OrganizationsClient({ onCount }: { onCount?: (n: number) => void } = {}) {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<OrgStatusFilter>("all");
  const [plan, setPlan] = useState<OrgPlanFilter>("all");
  const [creating, setCreating] = useState(false);

  const refetch = useCallback(async () => {
    const o = await api<{ organizations: Org[] }>("/api/platform/organizations");
    if (o.data) {
      setOrgs(o.data.organizations);
      onCount?.(o.data.organizations.length);
    }
  }, [onCount]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const visibles = useMemo(() => (orgs ? filterOrgs(orgs, { status, plan, q: query }) : null), [orgs, status, plan, query]);
  const counts = useMemo(() => countByStatus(orgs ?? []), [orgs]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" aria-hidden />
          <Input
            className="h-8 pl-8"
            placeholder="Buscar organización o Propietario"
            aria-label="Buscar organizaciones"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="platform-org-search"
          />
        </div>
        <Button
          size="sm"
          variant={creating ? "outline" : "default"}
          onClick={() => setCreating(!creating)}
          aria-expanded={creating}
          data-testid="platform-create-open"
        >
          <Plus className="h-4 w-4" /> {creating ? "Cerrar" : "Nueva organización"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtros de organizaciones">
        {ORG_STATUS_FILTERS.map((f) => (
          <Chip key={f} active={status === f} onClick={() => setStatus(f)} testId={`platform-filter-status-${f}`}>
            {ORG_STATUS_FILTER_LABEL[f]} <span className="tabular-nums text-text-3">{counts[f]}</span>
          </Chip>
        ))}
        <span aria-hidden className="mx-1 h-4 w-px bg-border" />
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value as OrgPlanFilter)}
          aria-label="Filtrar por plan"
          className="h-8 rounded-md border bg-card px-2 text-[13px]"
          data-testid="platform-filter-plan"
        >
          <option value="all">Todos los planes</option>
          {PLAN_KEYS.map((k) => (
            <option key={k} value={k}>
              {PLAN_LABEL[k]}
            </option>
          ))}
        </select>
      </div>

      {creating && <CreateOrganization onCreated={() => void refetch()} />}

      <div className="overflow-hidden rounded-md border bg-card">
        <div className={cn("hidden gap-5 border-b px-4 py-2 text-[11px] font-medium text-text-3 sm:grid", GRID)}>
          <span>Empresa</span>
          <span>Plan</span>
          <span>Módulos</span>
          <span>IA del mes</span>
          <span>{STORAGE_LABEL}</span>
          <span>Estado</span>
          <span />
        </div>
        {visibles === null ? (
          <p className="px-4 py-3 text-sm text-text-2">Cargando…</p>
        ) : visibles.length === 0 ? (
          <p className="px-4 py-3 text-sm text-text-2" data-testid="platform-org-empty">
            Ninguna organización coincide.
          </p>
        ) : (
          <ul className="divide-y" data-testid="platform-org-list">
            {visibles.map((org) => (
              <OrganizationRow key={org.id} org={org} />
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-text-3">Solo estado, metadatos y consumo. El contenido de cada negocio no se ve desde aquí.</p>
    </div>
  );
}
