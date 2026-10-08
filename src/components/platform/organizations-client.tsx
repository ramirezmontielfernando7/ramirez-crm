"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Copy, KeyRound, Plus, Search, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { roleLabel } from "@/lib/auth/permissions";
import {
  countActiveModules,
  PLATFORM_MODULE_LABEL,
  PLATFORM_MODULE_TOGGLES,
  type PlatformModuleToggle,
} from "@/lib/platform-modules";
import { aiMeter, STORAGE_LABEL, storageMeter } from "@/lib/usage";
import { cn } from "@/lib/utils";
import { api, fecha, type Member, type Modules, type Org } from "./api";
import { UsageDetail, UsageMeter } from "./usage";

/**
 * Fase 3, PR 2 / 036 (PR 4) — Plataforma → Organizaciones. Lista
 * minimalista: cada fila cerrada dice nombre, IA del mes contra su tope,
 * almacenamiento aproximado y cuántos módulos tiene; al abrirla, el consumo
 * del mes (por función y por agente), los módulos y las personas y el estado.
 * Solo metadatos y números: el contenido de cada negocio no se ve desde aquí.
 */

/** 030 (PR 4) — Por qué un interruptor está bloqueado (dependencias del registro). */
function blockedBy(key: PlatformModuleToggle, m: Modules): string | null {
  if (key === "lab" && !m.agent) return "Requiere el Agente";
  return null;
}

const STATUS_LABEL: Record<Org["status"], string> = {
  active: "Activa",
  suspended: "Suspendida",
  deleted: "Borrada",
};

const STATUS_DOT: Record<Org["status"], string> = {
  active: "bg-success",
  suspended: "bg-warning",
  deleted: "bg-destructive",
};

/**
 * Fase 3, PR 3 — Interruptores de los módulos de UNA organización. Lo que se
 * apaga deja de existir para ella al instante (pantallas y rutas en 404); lo
 * que ya tiene guardado no se borra.
 */
function ModuleToggles({ org, onChanged }: { org: Org; onChanged: () => void }) {
  const [modules, setModules] = useState<Modules>(org.modules);
  const [rate, setRate] = useState(String(org.modules.campaignSendRate));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setModules(org.modules);
    setRate(String(org.modules.campaignSendRate));
  }, [org.modules]);

  async function save(change: Partial<Modules>) {
    setBusy(true);
    setError(null);
    const r = await api<{ modules: Modules }>(`/api/platform/organizations/${org.id}/modules`, {
      method: "POST",
      body: JSON.stringify(change),
    });
    setBusy(false);
    if (r.data) setModules(r.data.modules);
    else setError(r.error);
    onChanged();
  }

  const disabled = busy || org.status === "deleted";
  return (
    <div className="space-y-2" data-testid="platform-modules">
      <p className="text-xs font-medium text-text-2">
        Módulos · {countActiveModules(modules).active} de {countActiveModules(modules).total} activos
      </p>
      <div className="grid gap-x-5 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {PLATFORM_MODULE_TOGGLES.map((key) => {
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
              {PLATFORM_MODULE_LABEL[key]}
              {blocked && <span className="text-xs text-text-3">({blocked})</span>}
            </label>
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
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}


/** Un enlace que se ve UNA vez: con botón de copiar y el aviso de qué es. */
function OneTimeLink({ url, expiresAt, kind }: { url: string; expiresAt: string; kind: "activate" | "reset" }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-sm" data-testid="platform-one-time-link">
      <p className="flex items-center gap-1.5 font-semibold">
        <ShieldAlert className="h-4 w-4" />
        {kind === "activate" ? "Enlace de activación" : "Enlace para poner contraseña"} — se muestra UNA sola vez
      </p>
      <code className="block break-all rounded bg-background px-2 py-1.5 text-xs" data-testid="platform-link-url">
        {url}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => setCopied(true));
          }}
        >
          <Copy className="h-3.5 w-3.5" /> {copied ? "Copiado" : "Copiar"}
        </Button>
        <span className="text-xs text-text-2">Caduca: {fecha(expiresAt)}. De un solo uso.</span>
      </div>
      <p className="text-xs text-text-2">
        Entrégalo solo a esa persona, por un canal de confianza. Quien tenga el enlace puede poner la contraseña: no lo
        uses tú ni lo compartas en un grupo.
      </p>
    </div>
  );
}


function CreateOrganization({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  // 030 (PR 4): plantilla de módulos; vacío = los de las variables de entorno.
  const [profile, setProfile] = useState<"" | "basico" | "completo">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const r = await api<{ activationUrl: string; expiresAt: string }>("/api/platform/organizations", {
      method: "POST",
      body: JSON.stringify({ name, ownerName, ownerEmail, ...(profile ? { profile } : {}) }),
    });
    setSaving(false);
    if (!r.ok || !r.data) {
      setError(r.error);
      return;
    }
    setLink({ url: r.data.activationUrl, expiresAt: r.data.expiresAt });
    setName("");
    setOwnerName("");
    setOwnerEmail("");
    setProfile("");
    onCreated();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nueva organización
        </CardTitle>
        <CardDescription>
          Se crea con su primer Propietario. La persona pone su contraseña con un enlace de activación (72 h, un solo uso).
          El registro público sigue cerrado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Nombre del negocio</Label>
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner-name">Nombre del Propietario</Label>
            <Input id="owner-name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner-email">Correo del Propietario</Label>
            <Input id="owner-email" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-profile">Módulos al crear</Label>
          <select
            id="org-profile"
            value={profile}
            onChange={(e) => setProfile(e.target.value as typeof profile)}
            className="h-9 rounded-sm border bg-background px-2 text-sm"
            data-testid="platform-create-profile"
          >
            <option value="">Los de las variables de entorno</option>
            <option value="basico">Básico (sin Agente, Laboratorio ni Campañas)</option>
            <option value="completo">Completo (todo, con menú personalizable)</option>
          </select>
          <p className="text-xs text-text-3">Solo es la plantilla inicial: después cada módulo se enciende o apaga aparte.</p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          disabled={saving || name.trim().length < 2 || !ownerName.trim() || !ownerEmail.includes("@")}
          onClick={() => void submit()}
          data-testid="platform-create-org"
        >
          {saving ? "Creando…" : "Crear organización"}
        </Button>
        {link && <OneTimeLink url={link.url} expiresAt={link.expiresAt} kind="activate" />}
      </CardContent>
    </Card>
  );
}


/** Restablecer la contraseña de una persona: pide la del administrador primero. */
function ResetLink({ member, onDone }: { member: Member; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const r = await api<{ url: string; expiresAt: string }>(`/api/platform/users/${member.userId}/link`, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    setPassword("");
    if (!r.ok || !r.data) {
      setError(r.error);
      onDone();
      return;
    }
    setLink(r.data);
    onDone();
  }

  if (link) return <OneTimeLink url={link.url} expiresAt={link.expiresAt} kind="reset" />;
  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="platform-reset-form">
      <p className="text-sm">
        Enlace de un solo uso (2 h) para que <b>{member.name}</b> ponga su propia contraseña. Tú nunca la ves. Confirma
        con <b>tu</b> contraseña de administrador:
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="password"
          autoComplete="current-password"
          className="max-w-xs"
          placeholder="Tu contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="platform-reauth-password"
        />
        <Button size="sm" disabled={busy || !password} onClick={() => void submit()} data-testid="platform-reset-submit">
          {busy ? "Verificando…" : "Generar enlace"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive" data-testid="platform-reset-error">{error}</p>}
    </div>
  );
}


/** Los 12 puntos de «x/12»: encendidos en el acento, apagados huecos. */
function ModuleDots({ modules }: { modules: Modules }) {
  const { active, total } = countActiveModules(modules);
  return (
    <span className="flex items-center gap-2" title={`${active} de ${total} módulos activos`}>
      <span className="hidden gap-0.5 lg:flex" aria-hidden>
        {PLATFORM_MODULE_TOGGLES.map((k) => (
          <span key={k} className={cn("h-1.5 w-1.5 rounded-full", modules[k] ? "bg-brand" : "bg-muted")} />
        ))}
      </span>
      <span className="text-xs tabular-nums text-text-2" data-testid="platform-org-modules-count">
        {active}/{total}
      </span>
    </span>
  );
}

function OrganizationRow({ org, adminUserId, onChanged }: { org: Org; adminUserId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ai = org.usage ? aiMeter(org.usage.ai, org.usage.ai.limits) : null;
  const storage = org.usage ? storageMeter(org.usage.storageBytes) : null;

  async function loadMembers() {
    const r = await api<{ members: Member[] }>(`/api/platform/organizations/${org.id}/members`);
    if (r.data) setMembers(r.data.members);
  }

  async function change(action: "suspend" | "reactivate" | "delete" | "restore") {
    const prompts = {
      suspend: `¿Suspender «${org.name}»? Sus personas salen al instante y no se envía ni recibe nada.`,
      reactivate: `¿Reactivar «${org.name}»?`,
      delete: `¿Borrar «${org.name}»? Queda 30 días en gracia (se puede restaurar); después se puede purgar.`,
      restore: `¿Restaurar «${org.name}»?`,
    };
    if (!window.confirm(prompts[action])) return;
    const reason = action === "suspend" || action === "delete" ? window.prompt("Motivo (queda en la bitácora):") ?? "" : "";
    setBusy(true);
    setError(null);
    const r = await api(`/api/platform/organizations/${org.id}/status`, {
      method: "POST",
      body: JSON.stringify({ action, reason }),
    });
    setBusy(false);
    if (!r.ok) setError(r.error);
    onChanged();
  }

  return (
    <li data-testid={`platform-org-${org.id}`} data-open={open ? "" : undefined}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`org-detail-${org.id}`}
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-4"
        data-testid="platform-org-toggle"
      >
        <div className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(4.5rem,auto)] sm:items-center sm:gap-5">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[org.status])} aria-hidden />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{org.name}</span>
              <span className="block truncate text-xs text-text-3">
                <span data-testid="platform-org-status">{STATUS_LABEL[org.status]}</span>
                {org.isPlatform && " · Plataforma"} · {org.members} persona(s)
              </span>
            </span>
            <span className="ml-auto shrink-0 sm:hidden">
              <ModuleDots modules={org.modules} />
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:contents">
            {ai ? <UsageMeter meter={ai} label="IA del mes" testId="platform-org-ai" /> : <span />}
            {storage ? <UsageMeter meter={storage} label={STORAGE_LABEL} testId="platform-org-storage" /> : <span />}
          </div>
          <span className="hidden justify-end sm:flex">
            <ModuleDots modules={org.modules} />
          </span>
        </div>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-text-3 transition-transform duration-200", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div id={`org-detail-${org.id}`} className="space-y-6 border-t bg-subtle px-3 py-4 sm:px-4" data-testid="platform-org-detail">
          <UsageDetail orgId={org.id} />

          <div className="border-t pt-4">
            <ModuleToggles org={org} onChanged={onChanged} />
          </div>

          <section className="space-y-2 border-t pt-4">
            <p className="text-xs font-medium text-text-2">Personas y estado</p>
            <p className="break-words text-xs text-text-2">
              WhatsApp {org.whatsappConnected ? "conectado" : "sin conectar"} · desde {fecha(org.createdAt)}
              <br />
              Propietario: {org.owners.map((o) => `${o.name} <${o.email}>`).join(", ") || "—"}
              {org.statusReason && ` · Motivo: ${org.statusReason}`}
              {org.status === "deleted" && ` · Se puede purgar desde ${fecha(org.purgeAfter)}`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPeopleOpen(!peopleOpen);
                  if (!members) void loadMembers();
                }}
              >
                {peopleOpen ? "Ocultar personas" : "Personas"}
              </Button>
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
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {peopleOpen && (
              <ul className="space-y-2 border-l-2 pl-3" data-testid="platform-members">
                {members === null && <li className="text-sm text-text-2">Cargando…</li>}
                {members?.map((m) => (
                  <li key={m.userId} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="break-all">{m.name}</span>
                      <span className="break-all text-text-2">{m.email}</span>
                      <Badge variant="outline">{roleLabel(m.role)}</Badge>
                      {m.userId !== adminUserId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setResetFor(resetFor === m.userId ? null : m.userId)}
                          data-testid="platform-reset-open"
                        >
                          <KeyRound className="h-3.5 w-3.5" /> Enlace para contraseña
                        </Button>
                      )}
                    </div>
                    {resetFor === m.userId && <ResetLink member={m} onDone={onChanged} />}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </li>
  );
}

export function OrganizationsClient({ adminUserId }: { adminUserId: string }) {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const refetch = useCallback(async () => {
    const o = await api<{ organizations: Org[] }>("/api/platform/organizations");
    if (o.data) setOrgs(o.data.organizations);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!orgs || !q) return orgs;
    return orgs.filter(
      (o) => o.name.toLowerCase().includes(q) || o.owners.some((w) => w.email.toLowerCase().includes(q) || w.name.toLowerCase().includes(q))
    );
  }, [orgs, query]);

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" aria-hidden />
          <Input
            className="pl-8"
            placeholder="Buscar organización"
            aria-label="Buscar organizaciones"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="platform-org-search"
          />
        </div>
        <Button
          variant={creating ? "outline" : "default"}
          onClick={() => setCreating(!creating)}
          aria-expanded={creating}
          data-testid="platform-create-open"
        >
          <Plus className="h-4 w-4" /> {creating ? "Cerrar" : "Nueva organización"}
        </Button>
      </div>

      {creating && <CreateOrganization onCreated={() => void refetch()} />}

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(4.5rem,auto)] gap-5 border-b px-4 py-2 pr-11 text-[11px] font-medium text-text-3 sm:grid">
          <span>Organización</span>
          <span>IA del mes</span>
          <span>{STORAGE_LABEL}</span>
          <span className="text-right">Módulos</span>
        </div>
        {visibles === null ? (
          <p className="px-4 py-3 text-sm text-text-2">Cargando…</p>
        ) : visibles.length === 0 ? (
          <p className="px-4 py-3 text-sm text-text-2">Ninguna organización coincide.</p>
        ) : (
          <ul className="divide-y" data-testid="platform-org-list">
            {visibles.map((org) => (
              <OrganizationRow key={org.id} org={org} adminUserId={adminUserId} onChanged={() => void refetch()} />
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-text-3">Solo estado, metadatos y consumo. El contenido de cada negocio no se ve desde aquí.</p>
    </div>
  );
}
