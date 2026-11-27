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
import { PLAN_LABEL, type ModuleProfile, type PlanOption } from "@/lib/modules/registry";
import {
  countActiveModules,
  FACTORY_PLAN_PROFILES,
  FEATURE_MARK_LABEL,
  featureMark,
  nearestPlan,
  planChangeDiff,
  PLATFORM_MODULE_LABEL,
  PLATFORM_MODULE_PILLAR,
  PLATFORM_MODULE_REQUIRES,
  PLATFORM_MODULE_TOGGLES,
  planKeyOf,
  planOfModules,
  planToggles,
  type FeatureMark,
  type PlanProfiles,
  type PlatformModuleToggle,
} from "@/lib/platform-modules";
import { orgPlanKey } from "@/lib/platform-orgs";
import { aiMeter, formatStorage, STORAGE_LABEL, storageMeter } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { api, fecha, type Member, type Modules, type Org } from "./api";
import { PLAN_HINT } from "./create-organization";
import { LimitsForm } from "./limits-form";
import { BillingSection } from "./billing-section";
import { OrgAiCard } from "./org-ai-card";
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
 * - B. IA y topes (`…/topes`): `OrgAiCard` (0070: tope en dólares y modelos) y `LimitsForm`.
 * - C. Consumo y almacenamiento (`…/consumo`): el detalle del mes.
 * - D. Accesos y estado (`…/accesos`): personas, enlaces de contraseña y
 *   suspender / reactivar / borrar / restaurar.
 *
 * Solo metadatos y números: el contenido del negocio no se ve desde aquí.
 */

/** 048 — Lo que trae cada plan HOY y los topes de personas y almacenamiento (para la vista previa). */
type PlanInfo = {
  planProfiles: PlanProfiles;
  planCaps: Partial<Record<ModuleProfile, { members: number; storageBytes: number } | null>>;
  limits: { members: number | null; storageBytes: number | null };
};
type Summary = { organization: Org } & PlanInfo;
type Ctx = { org: Org; info: PlanInfo | null; adminUserId: string; refetch: () => Promise<void> };
const OrgContext = createContext<Ctx | null>(null);

function useOrg(): Ctx {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg fuera de OrganizationShell");
  return ctx;
}

const base = (id: string) => `/platform/organizaciones/${id}`;

function organizationTabs(id: string) {
  return [
    { href: base(id), label: "Plan y módulos", match: (p: string) => p === base(id) },
    { href: `${base(id)}/cobro`, label: "Cobro y prueba" },
    { href: `${base(id)}/topes`, label: "IA y topes" },
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
  const [info, setInfo] = useState<PlanInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const r = await api<Summary>(`/api/platform/organizations/${orgId}/summary`);
    if (r.data) {
      const { organization, ...rest } = r.data;
      setOrg(organization);
      setInfo(rest);
    } else setError(r.error);
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
          <OrgContext.Provider value={{ org, info, adminUserId, refetch }}>{children}</OrgContext.Provider>
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
const PILLAR_ORDER = ["Bandeja", "Agenda", "Biblioteca", "Campañas", "Resultados", "Agentes IA", "Asistente", "Ajustes"] as const;

const TEMPLATES: ModuleProfile[] = ["inicio", "esencial", "pro", "ultra"];

/** 048 — El punto de color de cada marca de la pantalla de funciones. */
const MARK_DOT: Record<FeatureMark, string> = {
  included: "bg-success",
  extra: "bg-info",
  off: "bg-warning",
  not_included: "bg-border",
};

/**
 * 048 — Vista previa del cambio de plan: qué se enciende, qué se apaga, cómo
 * quedan las personas y el almacenamiento, y que ningún dato se borra. Nada
 * cambia hasta pulsar «Aplicar».
 */
function PlanChangePreview({
  orgName,
  from,
  to,
  current,
  target,
  info,
  busy,
  onCancel,
  onApply,
}: {
  orgName: string;
  from: PlanOption;
  to: ModuleProfile;
  current: Record<PlatformModuleToggle, boolean>;
  target: Record<PlatformModuleToggle, boolean>;
  info: PlanInfo | null;
  busy: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  const { turnOn, turnOff } = planChangeDiff(current, target);
  const caps = info?.planCaps[to] ?? null;
  const prev = from === "personalizado" ? null : (info?.planCaps[from] ?? null);
  // Igual que el servidor (`applyPlanCaps`): solo cambia un tope vacío o que era el del plan anterior.
  const next = (cur: number | null, plan: number | undefined, old: number | undefined) =>
    plan === undefined ? cur : cur === null || (old !== undefined && cur === old) ? plan : cur;
  const members = info ? next(info.limits.members, caps?.members, prev?.members) : null;
  const storage = info ? next(info.limits.storageBytes, caps?.storageBytes, prev?.storageBytes) : null;
  return (
    <div className="space-y-3 rounded-md border border-brand/40 bg-brand-tint/40 p-3 text-sm" role="region" aria-label="Vista previa del cambio de plan" data-testid="platform-plan-preview">
      <p className="font-medium">
        {orgName}: de {PLAN_LABEL[from]} a {PLAN_LABEL[to]}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div data-testid="platform-plan-preview-on">
          <p className="text-xs font-semibold text-success-text">Se enciende ({turnOn.length})</p>
          {turnOn.length === 0 ? (
            <p className="text-xs text-text-3">Nada nuevo.</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-xs">
              {turnOn.map((k) => (
                <li key={k}>+ {PLATFORM_MODULE_LABEL[k]}</li>
              ))}
            </ul>
          )}
        </div>
        <div data-testid="platform-plan-preview-off">
          <p className="text-xs font-semibold text-warning-text">Se apaga ({turnOff.length})</p>
          {turnOff.length === 0 ? (
            <p className="text-xs text-text-3">Nada se apaga.</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-xs">
              {turnOff.map((k) => (
                <li key={k}>− {PLATFORM_MODULE_LABEL[k]}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {info && (
        <p className="text-xs text-text-2" data-testid="platform-plan-preview-caps">
          Personas: {info.limits.members ?? "sin tope"} → {members ?? "sin tope"} · Almacenamiento: {info.limits.storageBytes === null ? "sin tope" : formatStorage(info.limits.storageBytes)} →{" "}
          {storage === null ? "sin tope" : formatStorage(storage)}
          {" "}(un tope que pusiste a mano se respeta)
        </p>
      )}
      <p className="text-xs text-text-2">
        <span className="font-medium">Ningún dato se borra:</span> lo que se apaga deja de verse, y vuelve con todo al encenderlo. Los complementos ocultos no cambian.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={onApply} data-testid="platform-plan-preview-apply">
          Aplicar {PLAN_LABEL[to]}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel} data-testid="platform-plan-preview-cancel">
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function PlanModulesSection() {
  const { org, info, refetch } = useOrg();
  const [modules, setModules] = useState<Modules>(org.modules);
  const [rate, setRate] = useState(String(org.modules.campaignSendRate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ModuleProfile | null>(null);

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

  const profiles = info?.planProfiles ?? FACTORY_PLAN_PROFILES;
  const disabled = busy || org.status === "deleted";
  const current = planOfModules(modules, profiles);
  const near = nearestPlan(modules, profiles);
  // 048: las marcas se comparan con su plan (o con el más parecido si es Personalizado).
  const basePlan: ModuleProfile = current === "personalizado" ? near.plan : current;
  const { active, total } = countActiveModules(modules);
  const extras = PLATFORM_MODULE_TOGGLES.filter((k) => featureMark(k, modules[k], basePlan, profiles) === "extra");
  const offs = PLATFORM_MODULE_TOGGLES.filter((k) => featureMark(k, modules[k], basePlan, profiles) === "off");
  return (
    <div className="space-y-4">
      <Section
        title="Cambiar de plan"
        hint="Elige un plan y antes de aplicarlo verás qué se enciende y qué se apaga. Ningún dato se borra."
        testId="platform-plan-templates"
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {[...TEMPLATES, "personalizado" as const].map((p) => {
            const on = current === p;
            const selected = preview === p;
            return (
              <button
                key={p}
                type="button"
                disabled={disabled || p === "personalizado" || on}
                aria-pressed={on || selected}
                onClick={() => {
                  if (p === "personalizado") return;
                  setPreview(selected ? null : p);
                }}
                className={cn(
                  "flex min-h-[4.5rem] flex-col items-start rounded-md border p-3 text-left transition-colors",
                  on ? "border-brand bg-brand-tint" : selected ? "border-brand ring-2 ring-brand/30" : "bg-background hover:bg-accent disabled:hover:bg-background",
                  "disabled:cursor-default"
                )}
                data-testid={`platform-template-${p}`}
              >
                <span className={cn("text-sm font-semibold", on && "text-brand-text")}>
                  {PLAN_LABEL[p]}
                  {on && <span className="ml-1.5 text-[11px] font-medium">· actual</span>}
                </span>
                <span className="mt-0.5 text-[11px] leading-snug text-text-3">
                  {p === "personalizado" ? "Los interruptores a mano, abajo." : PLAN_HINT[p]}
                </span>
                {p !== "personalizado" && (
                  <span className="mt-1 text-[11px] tabular-nums text-text-3">
                    {PLATFORM_MODULE_TOGGLES.filter((k) => profiles[p][k]).length}/{total} módulos
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {preview && (
          <PlanChangePreview
            orgName={org.name}
            from={current}
            to={preview}
            current={modules}
            target={planToggles(preview, profiles)}
            info={info}
            busy={disabled}
            onCancel={() => setPreview(null)}
            onApply={() => {
              setPreview(null);
              void save({ plan: preview });
            }}
          />
        )}
      </Section>

      <Section
        title={`Funciones · ${active} de ${total} activas`}
        hint="Lo que se apaga deja de existir para la empresa al instante (pantallas y rutas en 404), pero sus datos se guardan y vuelven al encenderlo."
        testId="platform-modules"
      >
        <p className="text-xs text-text-2" data-testid="platform-features-summary">
          <span data-testid="platform-modules-plan" className="font-medium">{SAVED_PLAN_LABEL[planKeyOf(current)]}</span>
          {current === "personalizado" && (
            <>
              {" "}
              · parecido a <span className="font-medium">{PLAN_LABEL[near.plan]}</span>
              {extras.length > 0 && ` · ${extras.length} extra${extras.length === 1 ? "" : "s"}`}
              {offs.length > 0 && ` · ${offs.length} apagada${offs.length === 1 ? "" : "s"}`}
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-3" aria-hidden>
          {(["included", "extra", "off", "not_included"] as const).map((m) => (
            <span key={m} className="inline-flex items-center gap-1">
              <span className={cn("h-2 w-2 rounded-full", MARK_DOT[m])} />
              {FEATURE_MARK_LABEL[m]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full border border-dashed border-text-3" />
            Oculto (complemento, abajo)
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PILLAR_ORDER.map((pillar) => {
            const keys = PLATFORM_MODULE_TOGGLES.filter((k) => PLATFORM_MODULE_PILLAR[k] === pillar);
            if (keys.length === 0) return null;
            return (
              <div key={pillar} className="space-y-2 rounded-md border bg-subtle p-3" data-testid={`platform-pillar-${pillar}`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{pillar}</p>
                {keys.map((key) => {
                  const blocked = blockedBy(key, modules);
                  const mark = featureMark(key, modules[key], basePlan, profiles);
                  const needs = PLATFORM_MODULE_REQUIRES[key];
                  return (
                    <div key={key} className="space-y-0.5" data-testid={`platform-module-${key}`} data-mark={mark} title={blocked ?? undefined}>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          size="sm"
                          checked={modules[key]}
                          disabled={disabled || blocked !== null}
                          label={`${PLATFORM_MODULE_LABEL[key]} en ${org.name}`}
                          onCheckedChange={(next) => void save({ [key]: next })}
                        />
                        <span className="min-w-0 flex-1">{PLATFORM_MODULE_LABEL[key]}</span>
                        <span className={cn("h-2 w-2 shrink-0 rounded-full", MARK_DOT[mark])} title={FEATURE_MARK_LABEL[mark]} />
                      </label>
                      <p className="pl-10 text-[11px] leading-snug text-text-3">
                        {FEATURE_MARK_LABEL[mark]}
                        {needs && ` · necesita ${PLATFORM_MODULE_LABEL[needs]}`}
                        {blocked && ` (${blocked})`}
                      </p>
                    </div>
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

      <Section
        title="Complementos ocultos"
        hint="Solo los ves tú. La organización no ve ningún rastro hasta que los enciendes. No cuentan entre los 13 ni cambian el plan."
        testId="platform-addons"
      >
        <label className="flex items-center gap-2 text-sm" data-testid="platform-addon-conexionDirecta">
          <Switch
            size="sm"
            checked={modules.conexionDirecta}
            disabled={disabled}
            label={`Conexión directa en ${org.name}`}
            onCheckedChange={(next) => void save({ conexionDirecta: next })}
          />
          <span className="min-w-0">Conexión directa (dispositivo vinculado)</span>
        </label>
        {modules.conexionDirecta && <DirectServerPicker orgId={org.id} disabled={disabled} />}
        {modules.conexionDirecta && (
          <MiNumeroControls orgId={org.id} orgName={org.name} modules={modules} disabled={disabled} save={save} />
        )}
        <label className="flex items-center gap-2 text-sm" data-testid="platform-addon-conectorIa">
          <Switch
            size="sm"
            checked={modules.conectorIa}
            disabled={disabled}
            label={`Conector de IA en ${org.name}`}
            onCheckedChange={(next) => void save({ conectorIa: next })}
          />
          <span className="min-w-0">Conector de IA (cada persona conecta su Claude o ChatGPT)</span>
        </label>
        {modules.conectorIa && org.usage?.aiConnector && (
          <p className="pl-10 text-xs text-text-3" data-testid="platform-ai-connector-usage">
            {org.usage.aiConnector.people === 1 ? "1 persona conectada" : `${org.usage.aiConnector.people} personas conectadas`} ·{" "}
            {org.usage.aiConnector.actions === 1 ? "1 acción" : `${org.usage.aiConnector.actions} acciones`} este mes ·{" "}
            {org.usage.aiConnector.sent === 1 ? "1 mensaje enviado" : `${org.usage.aiConnector.sent} mensajes enviados`} por IA
          </p>
        )}
      </Section>
    </div>
  );
}

/**
 * Mi número (046, PR 2) — Encender «Mi número» (cada persona vincula su
 * WhatsApp) y cuántos números caben. Muestra cuántos están en uso; bajar el
 * tope por debajo del uso no quita ninguno, solo impide autorizar más.
 */
function MiNumeroControls({
  orgId,
  orgName,
  modules,
  disabled,
  save,
}: {
  orgId: string;
  orgName: string;
  modules: Modules;
  disabled: boolean;
  save: (change: Partial<Modules>) => Promise<void>;
}) {
  const [max, setMax] = useState(String(modules.miNumeroMax));
  const [inUse, setInUse] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMax(String(modules.miNumeroMax)), [modules.miNumeroMax]);
  useEffect(() => {
    void api<{ connection: { numbersInUse: number } }>(`/api/platform/organizations/${orgId}/direct-connection`).then(
      (r) => r.data && setInUse(r.data.connection.numbersInUse)
    );
  }, [orgId, modules.miNumero]);

  return (
    <div className="space-y-2" data-testid="platform-addon-miNumero">
      <label className="flex items-center gap-2 text-sm">
        <Switch
          size="sm"
          checked={modules.miNumero}
          disabled={disabled}
          label={`Mi número en ${orgName}`}
          onCheckedChange={(next) => void save({ miNumero: next })}
        />
        <span className="min-w-0">Mi número (un WhatsApp por persona)</span>
      </label>
      {modules.miNumero && (
        <form
          className="ml-10 flex flex-wrap items-center gap-2 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            const n = Number(max);
            if (!Number.isInteger(n) || n < 0 || n > 200) {
              setError("El tope va de 0 a 200 números");
              return;
            }
            void save({ miNumeroMax: n });
          }}
        >
          <Label htmlFor={`mi-numero-max-${orgId}`} className="text-xs text-text-2">
            Números máximos
          </Label>
          <Input
            id={`mi-numero-max-${orgId}`}
            className="h-8 w-20"
            inputMode="numeric"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            disabled={disabled}
          />
          <Button size="sm" variant="outline" type="submit" disabled={disabled}>
            Guardar
          </Button>
          {inUse !== null && (
            <span className="text-text-3" data-testid="platform-mi-numero-in-use">
              En uso: {inUse} de {modules.miNumeroMax}
            </span>
          )}
          {error && <span className="text-destructive">{error}</span>}
        </form>
      )}
    </div>
  );
}

/** Conexión directa (PR 2) — El servidor de esta empresa. Con dispositivo vinculado ya no se cambia. */
function DirectServerPicker({ orgId, disabled }: { orgId: string; disabled: boolean }) {
  const [servers, setServers] = useState<{ id: string; name: string; used: number; maxInstances: number }[]>([]);
  const [conn, setConn] = useState<{
    serverId: string | null;
    serverName: string | null;
    status: string | null;
    phoneNumber: string | null;
    locked: boolean;
    metaless: boolean;
    aiViaDirect: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ servers: typeof servers }>("/api/platform/direct-servers").then((r) => r.data && setServers(r.data.servers));
    void api<{ connection: NonNullable<typeof conn> }>(`/api/platform/organizations/${orgId}/direct-connection`).then((r) => r.data && setConn(r.data.connection));
  }, [orgId]);

  async function assign(serverId: string) {
    setError(null);
    const r = await api<{ connection: NonNullable<typeof conn> }>(`/api/platform/organizations/${orgId}/direct-connection`, {
      method: "PUT",
      body: JSON.stringify({ serverId }),
    });
    if (r.data) setConn(r.data.connection);
    else setError(r.error);
  }

  async function setAi(aiViaDirect: boolean) {
    setError(null);
    const r = await api<{ connection: NonNullable<typeof conn> }>(`/api/platform/organizations/${orgId}/direct-connection`, {
      method: "PATCH",
      body: JSON.stringify({ aiViaDirect }),
    });
    if (r.data) setConn(r.data.connection);
    else setError(r.error);
  }

  return (
    <div className="ml-10 space-y-1 text-xs" data-testid="platform-direct-server-picker">
      <label className="flex items-center gap-2">
        <span className="text-text-3">Servidor</span>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={conn?.serverId ?? ""}
          disabled={disabled || conn?.locked}
          onChange={(e) => e.target.value && void assign(e.target.value)}
        >
          <option value="">Automático (el que tenga lugar)</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.used}/{s.maxInstances})
            </option>
          ))}
        </select>
      </label>
      {conn?.status && (
        <p className="text-text-3">
          Estado: {conn.status}
          {conn.phoneNumber ? ` · ${conn.phoneNumber}` : ""}
          {conn.locked ? " · con dispositivo vinculado" : ""}
        </p>
      )}
      {conn?.metaless && (
        <>
          <p className="text-text-3">Sin número de Meta: todos sus chats entran y salen por el dispositivo vinculado.</p>
          <label className="flex items-center gap-2" data-testid="platform-direct-ai">
            <input
              type="checkbox"
              checked={conn.aiViaDirect}
              disabled={disabled}
              onChange={(e) => void setAi(e.target.checked)}
            />
            <span>La IA contesta por conexión directa</span>
          </label>
        </>
      )}
      {error && <p className="text-destructive">{error}</p>}
    </div>
  );
}

/* ───────── 048. Cobro y prueba ───────── */

export function BillingTab() {
  const { org } = useOrg();
  return <BillingSection orgId={org.id} disabled={org.status === "deleted"} />;
}

/* ───────── B. IA y topes ───────── */

export function LimitsSection() {
  const { org, refetch } = useOrg();
  return (
    <div className="space-y-4">
      <OrgAiCard orgId={org.id} />
      <Section
        title="Otros topes y qué ve el cliente"
        hint="Almacenamiento, personas, módulos, documentos del agente y los topes en tokens de antes. Un campo vacío hereda. Bajar un tope por debajo del uso no quita nada: solo impide crecer."
      >
        <LimitsForm orgId={org.id} onSaved={() => void refetch()} />
      </Section>
    </div>
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
