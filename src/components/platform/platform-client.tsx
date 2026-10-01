"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Plus, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { roleLabel } from "@/lib/auth/permissions";

/**
 * Fase 3, PR 2 — Pantalla del administrador de plataforma. Solo metadatos de
 * las organizaciones (nombre, estado, personas): nunca su contenido.
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
};

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const r = await api<{ activationUrl: string; expiresAt: string }>("/api/platform/organizations", {
      method: "POST",
      body: JSON.stringify({ name, ownerName, ownerEmail }),
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
