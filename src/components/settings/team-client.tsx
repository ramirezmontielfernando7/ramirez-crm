"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export function TeamClient() {
  const viewer = useViewer();
  const canManage = viewer.can("users.manage");
  const canAssign = viewer.can("assignment.manage");
  const [members, setMembers] = useState<Member[]>([]);
  const [role, setRole] = useState<Role>("asesor");
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
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

  function generatePassword() {
    const alphabet =
      "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint32Array(14);
    crypto.getRandomValues(bytes);
    setTempPassword(
      Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")
    );
  }

  async function create() {
    setSaving(true);
    setError(null);
    setCreated(null);
    const res = await fetch("/api/settings/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password: tempPassword, role }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo crear la cuenta");
      return;
    }
    setCreated({ email, password: tempPassword });
    setRole("asesor");
    setName("");
    setEmail("");
    setTempPassword("");
    void refetch();
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
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Equipo y permisos</h2>
          <p className="mt-1 text-sm text-muted-foreground">
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
            <CardTitle>Crear cuenta de equipo</CardTitle>
            <CardDescription>
              Sin correos ni invitaciones: comparte tú mismo la contraseña
              temporal con tu compañero (se muestra UNA sola vez).
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
            <div className="space-y-1.5">
              <Label htmlFor="team-password">Contraseña temporal</Label>
              <div className="flex gap-2">
                <Input
                  id="team-password"
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                  placeholder="mínimo 8 caracteres"
                />
                <Button variant="outline" onClick={generatePassword}>
                  Generar
                </Button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {created && (
              <div className="rounded-md border border-success-soft bg-success-tint p-3 text-sm">
                <p className="font-medium text-success-text">Cuenta creada ✓</p>
                <p className="mt-1 text-success-text opacity-90">
                  Comparte estos datos ahora (no se volverán a mostrar):
                  <br />
                  <code>{created.email}</code> · contraseña{" "}
                  <code>{created.password}</code>
                </p>
              </div>
            )}
            <Button
              disabled={
                saving || !name.trim() || !email.trim() || tempPassword.length < 8
              }
              onClick={() => void create()}
            >
              <UserPlus className="h-4 w-4" />
              {saving ? "Creando…" : "Crear cuenta"}
            </Button>
          </CardContent>
        </Card>
      )}

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
