"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, MessageCircle, UserPlus } from "lucide-react";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useViewer } from "@/components/viewer-context";
import { ASSIGNABLE_ROLES, ROLE_LABEL, roleLabel, type Role } from "@/lib/auth/permissions";

type Member = {
  id: string;
  userId: string;
  role: string;
  name: string;
  email: string;
  createdAt: string;
  /** 020: cuántos chats tiene asignados. */
  assignedCount: number;
};

/** Qué puede hacer cada rol, dicho en una línea (para elegir con criterio). */
const ROLE_HINT: Record<Role, string> = {
  owner: "Ve y cambia todo, incluido el plan y la conexión.",
  coordinador: "Ve todos los chats, asigna y administra el día a día.",
  asesor: "Ve solo sus chats y los que le comparten.",
};

type InviteLink = { name: string; url: string; expiresAt: string; kind: "invite" | "access" };

/** El texto que sale en WhatsApp: corto, sin datos del negocio que no hagan falta. */
export function inviteMessage(link: Pick<InviteLink, "name" | "url" | "kind">): string {
  const saludo = link.name ? `Hola ${link.name.split(/\s+/)[0]}` : "Hola";
  return link.kind === "invite"
    ? `${saludo}: te di acceso a nuestro CRM. Entra con este enlace y pon tu contraseña (vale 72 horas y un solo uso): ${link.url}`
    : `${saludo}: aquí tienes un enlace para entrar al CRM y poner una contraseña nueva (vale 72 horas y un solo uso): ${link.url}`;
}

function LinkCard({ link, onClose }: { link: InviteLink; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const caduca = new Date(link.expiresAt).toLocaleString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div
      className="space-y-3 rounded-xl border border-success-soft bg-success-tint p-4 text-sm"
      data-testid="team-invite-link"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-success-text">
            {link.kind === "invite" ? `Invitación lista para ${link.name}` : `Enlace listo para ${link.name}`}
          </p>
          <p className="mt-0.5 text-success-text opacity-90">
            Mándaselo ahora: no se vuelve a mostrar. Vale hasta el {caduca} y se usa una sola vez.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-success-text underline-offset-2 hover:underline">
          Cerrar
        </button>
      </div>
      <code className="block break-all rounded-md bg-card px-3 py-2 text-xs text-text-2">{link.url}</code>
      <div className="flex flex-wrap gap-2">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(inviteMessage(link))}`}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ size: "sm" })}
        >
          <MessageCircle className="h-4 w-4" />
          Enviar por WhatsApp
        </a>
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          <Copy className="h-4 w-4" />
          {copied ? "Copiado ✓" : "Copiar enlace"}
        </Button>
      </div>
    </div>
  );
}

export function TeamClient() {
  const viewer = useViewer();
  const canManage = viewer.can("users.manage");
  const canAssign = viewer.can("assignment.manage");
  const [members, setMembers] = useState<Member[]>([]);
  const [role, setRole] = useState<Role>("asesor");
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  /** El enlace recién creado (alta o «Enlace para entrar»): se ve una sola vez. */
  const [link, setLink] = useState<InviteLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/team").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { members: Member[] };
    setMembers(data.members);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function create() {
    setSaving(true);
    setError(null);
    setLink(null);
    const res = await fetch("/api/settings/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, role }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo crear la cuenta");
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      link?: { url: string; expiresAt: string };
    } | null;
    if (data?.link) setLink({ name: name.trim(), ...data.link, kind: "invite" });
    setRole("asesor");
    setName("");
    setEmail("");
    void refetch();
  }

  async function newLink(m: Member) {
    setNotice(null);
    setError(null);
    setLink(null);
    const res = await fetch(`/api/settings/team/${m.id}/link`, { method: "POST" }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as
      | { url?: string; expiresAt?: string; error?: { message?: string } }
      | null;
    if (!res?.ok || !data?.url || !data.expiresAt) {
      setError(data?.error?.message ?? "No se pudo crear el enlace");
      return;
    }
    setLink({ name: m.name, url: data.url, expiresAt: data.expiresAt, kind: "access" });
  }

  async function request(url: string, init: RequestInit, ok: string) {
    setNotice(null);
    setError(null);
    const res = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json" },
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo completar la acción");
      return;
    }
    setNotice(ok);
    void refetch();
  }

  function changeRole(m: Member, next: Role) {
    void request(
      `/api/settings/team/${m.id}`,
      { method: "PATCH", body: JSON.stringify({ role: next }) },
      `${m.name} ahora es ${ROLE_LABEL[next]}.`
    );
  }

  function reassignAll(m: Member, toUserId: string) {
    const to = toUserId === "" ? null : toUserId;
    const toName = members.find((x) => x.userId === to)?.name;
    void request(
      "/api/assignments/bulk",
      {
        method: "POST",
        body: JSON.stringify({ fromUserId: m.userId, toUserId: to }),
      },
      toName
        ? `Los chats de ${m.name} pasaron a ${toName}.`
        : `Los chats de ${m.name} quedaron sin asignar.`
    );
  }

  function remove(m: Member) {
    if (!window.confirm(`¿Quitar a ${m.name} del equipo? Sus chats quedarán sin asignar.`)) {
      return;
    }
    void request(
      `/api/settings/team/${m.id}`,
      { method: "DELETE" },
      `${m.name} ya no es parte del equipo.`
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[min(100%,16rem)] flex-1 space-y-1">
          <h2 className="text-[22px] font-semibold tracking-tight max-lg:hidden">Equipo y permisos</h2>
          <p className="text-[13.5px] leading-relaxed text-text-2">
            {members.length} {members.length === 1 ? "persona" : "personas"} en tu equipo. Los roles se explican con palabras, no con una matriz.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setShowForm((v) => !v)}>
            <UserPlus className="h-4 w-4" />
            Invitar persona
          </Button>
        )}
      </div>

      {canManage && showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Invitar a alguien del equipo</CardTitle>
            <CardDescription>
              Te damos un enlace para mandárselo por WhatsApp. Con él pone su
              propia contraseña; vale 72 horas y un solo uso.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="team-name">Nombre</Label>
                <Input
                  id="team-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="team-email">Correo</Label>
                <Input
                  id="team-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-role">Rol</Label>
              <select
                id="team-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{ROLE_HINT[role]}</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              disabled={
                saving || !name.trim() || !email.trim()
              }
              onClick={() => void create()}
            >
              <UserPlus className="h-4 w-4" />
              {saving ? "Creando…" : "Crear invitación"}
            </Button>
          </CardContent>
        </Card>
      )}

      {link && <LinkCard link={link} onClose={() => setLink(null)} />}

      {notice && (
        <p className="rounded-md border border-success-soft bg-success-tint p-3 text-sm text-success-text">
          {notice}
        </p>
      )}
      {!canManage && error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <th className="px-4 py-3">Persona</th>
              <th className="px-4 py-3">Rol</th>
              <th className="px-4 py-3">Chats asignados</th>
              <th className="px-4 py-3">En el equipo desde</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b last:border-b-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <ContactAvatar name={m.name} seed={m.id} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {m.role !== "owner" && canManage ? (
                    <select
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value as Role)}
                      aria-label={`Rol de ${m.name}`}
                      className="h-8 rounded-md border border-input bg-card px-2 text-sm"
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge variant={m.role === "owner" ? "default" : "secondary"}>{roleLabel(m.role)}</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{m.assignedCount}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(m.createdAt).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}
                </td>
                <td className="px-4 py-3">
                  {/* 020: acciones por persona. Solo aparecen si el rol puede. */}
                  {m.role !== "owner" && (canManage || canAssign) && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {canAssign && m.assignedCount > 0 && (
                        <select
                          value="__"
                          onChange={(e) => reassignAll(m, e.target.value)}
                          aria-label={`Reasignar todos los chats de ${m.name}`}
                          className="h-8 min-w-0 max-w-[11rem] rounded-md border border-input bg-card px-2 text-xs"
                        >
                          <option value="__" disabled>
                            Reasignar todos sus chats a…
                          </option>
                          <option value="">Sin asignar</option>
                          {members
                            .filter((x) => x.userId !== m.userId)
                            .map((x) => (
                              <option key={x.userId} value={x.userId}>
                                {x.name}
                              </option>
                            ))}
                        </select>
                      )}
                      {canManage && m.userId !== viewer.userId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void newLink(m)}
                          title="Para que entre y ponga una contraseña nueva (si la olvidó o no usó la invitación)"
                        >
                          <KeyRound className="h-4 w-4" />
                          Enlace para entrar
                        </Button>
                      )}
                      {canManage && (
                        <Button size="sm" variant="ghost" onClick={() => remove(m)}>
                          Quitar del equipo
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {(["owner", "coordinador", "asesor"] as const).map((r) => (
          <div key={r} className="rounded-xl border bg-card p-4">
            <p className="font-medium">{ROLE_LABEL[r]}</p>
            <p className="mt-1 text-sm text-muted-foreground">{ROLE_HINT[r]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
