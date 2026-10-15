"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageShell } from "@/components/ui/page-shell";
import { Switch } from "@/components/ui/switch";
import { roleLabel } from "@/lib/auth/permissions";
import { PLAN_LABEL as SAVED_PLAN_LABEL } from "@/lib/limits";
import { MODULE_PROFILES, PLAN_LABEL, type ModuleProfile } from "@/lib/modules/registry";
import {
  countActiveModules,
  PLATFORM_MODULE_LABEL,
  PLATFORM_MODULE_PILLAR,
  PLATFORM_MODULE_TOGGLES,
  planKeyOf,
  planOfModules,
  type PlatformModuleToggle,
} from "@/lib/platform-modules";
import { orgPlanKey } from "@/lib/platform-orgs";
import { aiMeter, STORAGE_LABEL, storageMeter } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { api, fecha, type Member, type Modules, type Org } from "./api";
import { PLAN_HINT } from "./create-organization";
import { LimitsForm } from "./limits-form";
import { ResetLink, ResetLinkButton } from "./one-time-link";
import { STATUS_DOT, STATUS_LABEL } from "./organizations-client";
import { UsageDetail, UsageMeter } from "./usage";

/**
 * 040 — La ficha de UNA organización en /platform, en pestañas (rutas: el
 * enlace se comparte y Atrás funciona) en vez de una sola pantalla larga:
 *
 * - A. Plan y módulos (`/platform/organizaciones/[id]`): plantillas rápidas
 *   (Esencial, Pro, Ultra; Personalizado = a mano) y los 13 interruptores
 *   agrupados por los pilares del CRM.
 * - B. Topes y visibilidad (`…/topes`): `LimitsForm`.
 * - C. Consumo y almacenamiento (`…/consumo`): el detalle del mes.
 * - D. Accesos y estado (`…/accesos`): personas, enlaces de contraseña y
 *   suspender / reactivar / borrar / restaurar.
 *
 * Solo metadatos y números: el contenido del negocio no se ve desde aquí.
 */

type Ctx = { org: Org; adminUserId: string; refetch: () => Promise<void> };
const OrgContext = createContext<Ctx | null>(null);

function useOrg(): Ctx {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg fuera de OrganizationShell");
  return ctx;
}

const base = (id: string) => `/platform/organizaciones/${id}`;

export function organizationTabs(id: string) {
  return [
    { href: base(id), label: "Plan y módulos", match: (p: string) => p === base(id) },
    { href: `${base(id)}/topes`, label: "Topes y visibilidad" },
    { href: `${base(id)}/consumo`, label: "Consumo y almacenamiento" },
    { href: `${base(id)}/accesos`, label: "Accesos y estado" },
  ] as const;
}

export function OrganizationShell({
  orgId,
  adminUserId,
  children,
}: {
  orgId: string;
  adminUserId: string;
  children: React.ReactNode;
}) {
  const [org, setOrg] = useState<Org | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const r = await api<{ organization: Org }>(`/api/platform/organizations/${orgId}/summary`);
    if (r.data) setOrg(r.data.organization);
    else setError(r.error);
  }, [orgId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const plan = org ? orgPlanKey(org) : null;
  return (
    <PageShell
      title={org?.name ?? "Organización"}
      icon={Building2}
      pillar={false}
      back={{ href: "/platform/organizaciones", label: "Volver a Organizaciones" }}
      badge={
        org ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-2" data-testid="platform-detail-badge">
            <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[org.status])} aria-hidden />
            <span data-testid="platform-org-status">{STATUS_LABEL[org.status]}</span>
            {plan && (
              <span className="rounded-sm bg-muted px-1.5 py-0.5 font-medium" data-testid="platform-org-plan" data-plan={plan}>
                {SAVED_PLAN_LABEL[plan]}
              </span>
            )}
          </span>
        ) : null
      }
      tabs={organizationTabs(orgId)}
      tabsLabel="Secciones de la organización"
    >
      <div data-testid="platform-org-detail" data-org-id={orgId}>
        {org ? (
          <OrgContext.Provider value={{ org, adminUserId, refetch }}>{children}</OrgContext.Provider>
        ) : (
          <p className={cn("text-sm", error ? "text-destructive" : "text-text-2")}>{error ?? "Cargando…"}</p>
        )}
      </div>
    </PageShell>
  );
}

/** Un bloque de la ficha: título, una línea de ayuda y su contenido. */
function Section({ title, hint, children, testId }: { title: string; hint?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" data-testid={testId}>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-text-3">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/* ───────── A. Plan y módulos ───────── */

/** 030 (PR 4) — Por qué un interruptor está bloqueado (dependencias del registro). */
function blockedBy(key: PlatformModuleToggle, m: Modules): string | null {
  if (key === "lab" && !m.agent) return "Requiere el Agente";
  return null;
}

/** El orden de los pilares del menú (039), para agrupar los 13. */
const PILLAR_ORDER = ["Bandeja", "CRM Comercial", "Estudio de IA", "Marketing", "Inteligencia", "Ajustes"] as const;

const TEMPLATES: ModuleProfile[] = ["esencial", "pro", "ultra"];

export function PlanModulesSection() {
  const { org, refetch } = useOrg();
  const [modules, setModules] = useState<Modules>(org.modules);
  const [rate, setRate] = useState(String(org.modules.campaignSendRate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setModules(org.modules);
    setRate(String(org.modules.campaignSendRate));
  }, [org.modules]);

  async function save(change: Partial<Modules> | { plan: ModuleProfile }) {
    setBusy(true);
    setError(null);
    const r = await api<{ modules: Modules }>(`/api/platform/organizations/${org.id}/modules`, {
      method: "POST",
      body: JSON.stringify(change),
    });
    setBusy(false);
    if (r.data) setModules(r.data.modules);
    else setError(r.error);
    await refetch();
  }

  const disabled = busy || org.status === "deleted";
  const current = planOfModules(modules);
  const { active, total } = countActiveModules(modules);
  return (
    <div className="space-y-4">
      <Section
        title="Plantilla rápida"
        hint="Aplica de un golpe los 13 interruptores de un plan. Mover cualquiera a mano la deja en «Personalizado». Lo que ya tiene guardado no se borra."
        testId="platform-plan-templates"
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[...TEMPLATES, "personalizado" as const].map((p) => {
            const on = current === p;
            return (
              <button
                key={p}
                type="button"
                disabled={disabled || p === "personalizado" || on}
                aria-pressed={on}
                onClick={() => {
                  if (p === "personalizado") return;
                  if (!window.confirm(`¿Aplicar el plan ${PLAN_LABEL[p]} a «${org.name}»? Cambia sus 13 módulos a la vez.`)) return;
                  void save({ plan: p });
                }}
                className={cn(
                  "flex min-h-[4.5rem] flex-col items-start rounded-md border p-3 text-left transition-colors",
                  on ? "border-brand bg-brand-tint" : "bg-background hover:bg-accent disabled:hover:bg-background",
                  "disabled:cursor-default"
                )}
                data-testid={`platform-template-${p}`}
              >
                <span className={cn("text-sm font-semibold", on && "text-brand-text")}>
                  {PLAN_LABEL[p]}
                  {on && <span className="ml-1.5 text-[11px] font-medium">· actual</span>}
                </span>
                <span className="mt-0.5 text-[11px] leading-snug text-text-3">
                  {p === "personalizado" ? "Los 13 interruptores a mano, abajo." : PLAN_HINT[p]}
                </span>
                {p !== "personalizado" && (
                  <span className="mt-1 text-[11px] tabular-nums text-text-3">
                    {Object.values(MODULE_PROFILES[p].modules).filter(Boolean).length}/{total} módulos
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title={`Módulos · ${active} de ${total} activos`}
        hint="Lo que se apaga deja de existir para la organización al instante (pantallas y rutas en 404)."
        testId="platform-modules"
      >
        <p className="text-xs text-text-2">
          Hoy corresponden a: <span data-testid="platform-modules-plan" className="font-medium">{SAVED_PLAN_LABEL[planKeyOf(current)]}</span>
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PILLAR_ORDER.map((pillar) => {
            const keys = PLATFORM_MODULE_TOGGLES.filter((k) => PLATFORM_MODULE_PILLAR[k] === pillar);
            if (keys.length === 0) return null;
            return (
              <div key={pillar} className="space-y-2 rounded-md border bg-subtle p-3" data-testid={`platform-pillar-${pillar}`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{pillar}</p>
                {keys.map((key) => {
                  const blocked = blockedBy(key, modules);
                  return (
                    <label
                      key={key}
                      className="flex items-center gap-2 text-sm"
                      data-testid={`platform-module-${key}`}
                      title={blocked ?? undefined}
                    >
                      <Switch
                        size="sm"
                        checked={modules[key]}
                        disabled={disabled || blocked !== null}
                        label={`${PLATFORM_MODULE_LABEL[key]} en ${org.name}`}
                        onCheckedChange={(next) => void save({ [key]: next })}
                      />
                      <span className="min-w-0">{PLATFORM_MODULE_LABEL[key]}</span>
                      {blocked && <span className="text-xs text-text-3">({blocked})</span>}
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
        {modules.campaigns && (
          <form
            className="flex flex-wrap items-center gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(rate);
              if (!Number.isInteger(n) || n < 1 || n > 80) {
                setError("El ritmo va de 1 a 80 mensajes por segundo");
                return;
              }
              void save({ campaignSendRate: n });
            }}
          >
            <Label htmlFor={`rate-${org.id}`} className="text-xs text-text-2">
              Ritmo de campañas (mensajes/s)
            </Label>
            <Input
              id={`rate-${org.id}`}
              className="h-8 w-20"
              inputMode="numeric"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              disabled={disabled}
            />
            <Button size="sm" variant="outline" type="submit" disabled={disabled}>
              Guardar
            </Button>
          </form>
        )}
        {error && (
          <p className="text-sm text-destructive" data-testid="platform-modules-error">
            {error}
          </p>
        )}
      </Section>
    </div>
  );
}

/* ───────── B. Topes y visibilidad ───────── */

export function LimitsSection() {
  const { org, refetch } = useOrg();
  return (
    <Section
      title="Topes y visibilidad"
      hint="Un campo vacío hereda (del entorno o sin tope). Bajar un tope por debajo del uso no quita nada: solo impide crecer."
    >
      <LimitsForm orgId={org.id} onSaved={() => void refetch()} />
    </Section>
  );
}

/* ───────── C. Consumo y almacenamiento ───────── */

export function UsageSection() {
  const { org } = useOrg();
  const ai = org.usage ? aiMeter(org.usage.ai, org.usage.ai.limits) : null;
  const storage = org.usage ? storageMeter(org.usage.storageBytes, org.usage.plan.storageLimitBytes) : null;
  return (
    <div className="space-y-4">
      {(ai || storage) && (
        <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2">
          {ai && <UsageMeter meter={ai} label="IA del mes" testId="platform-org-ai" />}
          {storage && <UsageMeter meter={storage} label={STORAGE_LABEL} testId="platform-org-storage" />}
        </div>
      )}
      <Section title="Detalle del mes" hint="Por función, por agente y espacio en disco. Solo lectura.">
        <UsageDetail orgId={org.id} storageLimitBytes={org.usage?.plan.storageLimitBytes ?? null} />
      </Section>
    </div>
  );
}

/* ───────── D. Accesos y estado ───────── */

export function AccessSection() {
  const { org, adminUserId, refetch } = useOrg();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ members: Member[] }>(`/api/platform/organizations/${org.id}/members`).then((r) => {
      if (r.data) setMembers(r.data.members);
    });
  }, [org.id]);

  async function change(action: "suspend" | "reactivate" | "delete" | "restore") {
    const prompts = {
      suspend: `¿Suspender «${org.name}»? Sus personas salen al instante y no se envía ni recibe nada.`,
      reactivate: `¿Reactivar «${org.name}»?`,
      delete: `¿Borrar «${org.name}»? Queda 30 días en gracia (se puede restaurar); después se puede purgar.`,
      restore: `¿Restaurar «${org.name}»?`,
    };
    if (!window.confirm(prompts[action])) return;
    const reason = action === "suspend" || action === "delete" ? (window.prompt("Motivo (queda en la bitácora):") ?? "") : "";
    setBusy(true);
    setError(null);
    const r = await api(`/api/platform/organizations/${org.id}/status`, {
      method: "POST",
      body: JSON.stringify({ action, reason }),
    });
    setBusy(false);
    if (!r.ok) setError(r.error);
    await refetch();
  }

  return (
    <div className="space-y-4">
      <Section title="Estado" testId="platform-org-state">
        <p className="break-words text-xs text-text-2">
          {STATUS_LABEL[org.status]} · WhatsApp {org.whatsappConnected ? "conectado" : "sin conectar"} · desde {fecha(org.createdAt)}
          {org.statusReason && ` · Motivo: ${org.statusReason}`}
          {org.status === "deleted" && ` · Se puede purgar desde ${fecha(org.purgeAfter)}`}
        </p>
        <div className="flex flex-wrap gap-2">
          {!org.isPlatform && org.status === "active" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void change("suspend")} data-testid="platform-suspend">
              Suspender
            </Button>
          )}
          {org.status === "suspended" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void change("reactivate")} data-testid="platform-reactivate">
              Reactivar
            </Button>
          )}
          {!org.isPlatform && org.status !== "deleted" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void change("delete")} data-testid="platform-delete">
              Borrar
            </Button>
          )}
          {org.status === "deleted" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void change("restore")} data-testid="platform-restore">
              Restaurar
            </Button>
          )}
          {org.isPlatform && <span className="text-xs text-text-3">La organización de la plataforma no se suspende ni se borra.</span>}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </Section>

      <Section
        title="Personas y accesos"
        hint="Para que alguien ponga su contraseña: un enlace de un solo uso (2 h). Tú nunca la ves."
        testId="platform-members-section"
      >
        <ul className="divide-y rounded-md border" data-testid="platform-members">
          {members === null && <li className="px-3 py-2 text-sm text-text-2">Cargando…</li>}
          {members?.length === 0 && <li className="px-3 py-2 text-sm text-text-2">Sin personas.</li>}
          {members?.map((m) => (
            <li key={m.userId} className="space-y-2 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="break-all font-medium">{m.name}</span>
                <span className="break-all text-text-2">{m.email}</span>
                <Badge variant="outline">{roleLabel(m.role)}</Badge>
                {m.userId !== adminUserId && (
                  <span className="ml-auto">
                    <ResetLinkButton open={resetFor === m.userId} onClick={() => setResetFor(resetFor === m.userId ? null : m.userId)} />
                  </span>
                )}
              </div>
              {resetFor === m.userId && <ResetLink member={m} onDone={() => void refetch()} />}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
