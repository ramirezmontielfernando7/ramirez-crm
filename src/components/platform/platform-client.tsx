"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Plus, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { roleLabel } from "@/lib/auth/permissions";

/**
 * Fase 3, PR 2 — Pantalla del administrador de plataforma. Solo metadatos de
 * las organizaciones (nombre, estado, personas, módulos): nunca su contenido.
 */

type Org = {
  id: string;
  name: string;
  slug: string | null;
  status: "active" | "suspended" | "deleted";
  statusReason: string | null;
  purgeAfter: string | null;
  createdAt: string;
  isPlatform: boolean;
  members: number;
  owners: { userId: string; name: string; email: string }[];
  whatsappConnected: boolean;
  modules: Modules;
};

/** Fase 3, PR 3 — Los módulos opcionales de una organización. */
type Modules = {
  campaigns: boolean;
  agenda: boolean;
  atribucion: boolean;
  instagram: boolean;
  messenger: boolean;
  campaignSendRate: number;
  /** 030 (PR 4) — nacen encendidos; `lab` requiere `agent`. */
  knowledge: boolean;
  agent: boolean;
  lab: boolean;
  teamChat: boolean;
  results: boolean;
  customNav: boolean;
};

type ModuleKey = Exclude<keyof Modules, "campaignSendRate">;

const MODULE_LABEL: Record<ModuleKey, string> = {
  teamChat: "Chat de equipo",
  knowledge: "Conocimientos",
  results: "Resultados",
  agent: "Agente",
  lab: "Laboratorio",
  campaigns: "Campañas",
  agenda: "Agenda",
  atribucion: "Atribución (Meta)",
  instagram: "Instagram",
  messenger: "Messenger",
  customNav: "Menú personalizable",
};

/** 030 (PR 4) — Por qué un interruptor está bloqueado (dependencias del registro). */
function blockedBy(key: ModuleKey, m: Modules): string | null {
  if (key === "lab" && !m.agent) return "Requiere el Agente";
  return null;
}

type Member = { userId: string; name: string; email: string; role: string };

type AuditEntry = {
  id: string;
  at: string;
  actorEmail: string | null;
  action: string;
  targetOrgName: string | null;
  targetUserEmail: string | null;
  ip: string | null;
};

const STATUS_LABEL: Record<Org["status"], string> = {
  active: "Activa",
  suspended: "Suspendida",
  deleted: "Borrada",
};

const ACTION_LABEL: Record<string, string> = {
  "organization.created": "creó la organización",
  "organization.suspended": "suspendió la organización",
  "organization.reactivated": "reactivó la organización",
  "organization.deleted": "borró la organización (30 días de gracia)",
  "organization.restored": "restauró la organización",
  "organization.purged": "purgó la organización",
  "organization.modules_changed": "cambió los módulos de la organización",
  "link.activation_created": "generó un enlace de activación",
  "link.reset_created": "generó un enlace de restablecimiento",
  "link.used": "se usó un enlace de contraseña",
  "reauth.failed": "contraseña de administrador incorrecta",
  "reauth.locked": "bloqueo temporal por intentos fallidos",
  "admin.added": "agregó un administrador de plataforma",
  "admin.removed": "quitó un administrador de plataforma",
};

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  return {
    ok: res.ok,
    status: res.status,
    data: res.ok ? json : null,
    error: res.ok ? null : json?.error?.message ?? `Error ${res.status}`,
  };
}

function fecha(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

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
    <div className="space-y-2 rounded-md border px-3 py-2" data-testid="platform-modules">
      <p className="text-xs font-medium text-text-2">Módulos</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {(Object.keys(MODULE_LABEL) as ModuleKey[]).map((key) => {
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
                label={`${MODULE_LABEL[key]} en ${org.name}`}
                onCheckedChange={(next) => void save({ [key]: next })}
              />
              {MODULE_LABEL[key]}
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

function OrganizationRow({ org, adminUserId, onChanged }: { org: Org; adminUserId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <li className="space-y-2 py-3" data-testid={`platform-org-${org.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{org.name}</span>
        <Badge variant={org.status === "active" ? "success" : org.status === "suspended" ? "warning" : "destructive"} data-testid="platform-org-status">
          {STATUS_LABEL[org.status]}
        </Badge>
        {org.isPlatform && <Badge variant="outline">Plataforma</Badge>}
        <span className="text-xs text-text-2">
          {org.members} persona(s) · WhatsApp {org.whatsappConnected ? "conectado" : "sin conectar"} · desde {fecha(org.createdAt)}
        </span>
      </div>
      <p className="text-xs text-text-2">
        Propietario: {org.owners.map((o) => `${o.name} <${o.email}>`).join(", ") || "—"}
        {org.statusReason && ` · Motivo: ${org.statusReason}`}
        {org.status === "deleted" && ` · Se puede purgar desde ${fecha(org.purgeAfter)}`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setOpen(!open);
            if (!members) void loadMembers();
          }}
        >
          {open ? "Ocultar personas" : "Personas"}
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
      <ModuleToggles org={org} onChanged={onChanged} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {open && (
        <ul className="space-y-2 border-l-2 pl-3">
          {members === null && <li className="text-sm text-text-2">Cargando…</li>}
          {members?.map((m) => (
            <li key={m.userId} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>{m.name}</span>
                <span className="text-text-2">{m.email}</span>
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
    </li>
  );
}

export function PlatformClient({ adminUserId }: { adminUserId: string }) {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const refetch = useCallback(async () => {
    const [o, a] = await Promise.all([
      api<{ organizations: Org[] }>("/api/platform/organizations"),
      api<{ entries: AuditEntry[] }>("/api/platform/audit"),
    ]);
    if (o.data) setOrgs(o.data.organizations);
    if (a.data) setAudit(a.data.entries);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return (
    <div className="max-w-5xl space-y-6">
      <CreateOrganization onCreated={() => void refetch()} />

      <Card>
        <CardHeader>
          <CardTitle>Organizaciones</CardTitle>
          <CardDescription>Solo estado y metadatos. El contenido de cada negocio no se ve desde aquí.</CardDescription>
        </CardHeader>
        <CardContent>
          {orgs === null ? (
            <p className="text-sm text-text-2">Cargando…</p>
          ) : (
            <ul className="divide-y" data-testid="platform-org-list">
              {orgs.map((org) => (
                <OrganizationRow key={org.id} org={org} adminUserId={adminUserId} onChanged={() => void refetch()} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bitácora de plataforma</CardTitle>
          <CardDescription>Quién hizo qué, sobre qué organización, cuándo y desde qué IP.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-sm" data-testid="platform-audit">
            {audit.length === 0 && <li className="text-text-2">Sin registros todavía.</li>}
            {audit.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2">
                <span className="text-text-2">{fecha(e.at)}</span>
                <span className="font-medium">{e.actorEmail ?? "—"}</span>
                <span>{ACTION_LABEL[e.action] ?? e.action}</span>
                {e.targetOrgName && <span>· {e.targetOrgName}</span>}
                {e.targetUserEmail && <span className="text-text-2">· {e.targetUserEmail}</span>}
                {e.ip && <span className="text-text-3">· {e.ip}</span>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
