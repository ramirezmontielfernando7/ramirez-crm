"use client";

import { useCallback, useEffect, useState } from "react";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { roleLabel } from "@/lib/auth/permissions";
import { CONNECTION_STATUS_LABEL, type DirectConnectionStatus } from "@/lib/direct-connection";
import { KIND_LABEL, MI_NUMERO_TEXT, SWITCH_ORDER, SWITCH_TEXT, type NumberSwitch } from "@/lib/mi-numero";

type Kind = "personal" | "empresa";
type TeamNumber = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  kind: Kind;
  label: string | null;
  switches: Record<NumberSwitch, boolean>;
  noticeAcceptedAt: string | null;
  connection: { status: DirectConnectionStatus; phoneNumber: string | null; pausedUntil: string | null };
};
type Team = {
  max: number;
  inUse: number;
  numbers: TeamNumber[];
  candidates: { userId: string; name: string; email: string; role: string }[];
};

async function errorOf(r: Response | null): Promise<string> {
  if (!r) return "Sin conexión. Intenta de nuevo.";
  const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? "No se pudo completar la acción.";
}

/**
 * Mi número (046), PR 3 — «Números del equipo» (Propietario y Coordinador):
 * autorizar a una persona dentro del tope, su tipo, los ajustes de un número
 * de la empresa y revocarlo. De un número personal solo se ve su estado:
 * jamás sus chats ni sus ajustes.
 */
export function TeamNumbersClient() {
  const [team, setTeam] = useState<Team | null>(null);
  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState<Kind>("personal");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/settings/mi-numero").catch(() => null);
    if (!r?.ok) return setError(await errorOf(r));
    setTeam((await r.json()) as Team);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    const r = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      setError(await errorOf(r));
      return false;
    }
    await load();
    return true;
  }

  async function authorize() {
    const ok = await send("/api/settings/mi-numero", "POST", { userId, kind, label: label.trim() || null });
    if (ok) {
      setUserId("");
      setKind("personal");
      setLabel("");
    }
  }

  if (!team) return <p className="text-sm text-muted-foreground">{error ?? "Cargando…"}</p>;
  const full = team.inUse >= team.max;

  return (
    <div className="max-w-3xl space-y-4" data-testid="team-numbers">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          Números del equipo
          <Badge variant="secondary" data-testid="team-numbers-in-use">
            {team.inUse} de {team.max}
          </Badge>
        </h2>
        <p className="text-sm text-muted-foreground">{MI_NUMERO_TEXT.teamIntro}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Autorizar a una persona</CardTitle>
          <CardDescription>
            {full
              ? "Ya usas todos los números de tu plan. Revoca uno o pide más a soporte."
              : "La persona verá «Mi número» en sus ajustes, leerá el aviso y escaneará su código."}
          </CardDescription>
        </CardHeader>
        {!full && (
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mi-numero-person">Persona</Label>
                <select
                  id="mi-numero-person"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                >
                  <option value="">Elige a alguien del equipo…</option>
                  {team.candidates.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.name} · {roleLabel(c.role)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mi-numero-label">Nombre del número (opcional)</Label>
                <Input id="mi-numero-label" value={label} maxLength={60} placeholder="Ej. Ventas Norte" onChange={(e) => setLabel(e.target.value)} />
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">¿De quién es el número?</legend>
              {(["personal", "empresa"] as const).map((k) => (
                <label key={k} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input type="radio" name="mi-numero-kind" className="mt-1" checked={kind === k} onChange={() => setKind(k)} />
                  <span>{MI_NUMERO_TEXT.kindHelp[k]}</span>
                </label>
              ))}
            </fieldset>
            <Button disabled={busy || !userId} onClick={() => void authorize()} data-testid="mi-numero-authorize">
              Autorizar
            </Button>
          </CardContent>
        )}
      </Card>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Números autorizados</p>
        {team.numbers.length === 0 && <p className="text-sm text-muted-foreground">Aún nadie tiene su número.</p>}
        {team.numbers.map((n) => {
          const url = `/api/settings/mi-numero/${n.id}`;
          const lockedPersonal = n.kind === "personal" && n.noticeAcceptedAt !== null;
          return (
            <div key={n.id} className="space-y-3 rounded-lg border bg-card px-4 py-3" data-testid="team-number">
              <div className="flex items-center gap-3">
                <ContactAvatar name={n.userName} seed={n.userId} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {n.userName}
                    {n.label && <span className="font-normal text-muted-foreground"> · {n.label}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {n.connection.phoneNumber ? `+${n.connection.phoneNumber}` : n.noticeAcceptedAt ? "Aún no escanea su código" : "Aún no acepta el aviso"}
                  </p>
                </div>
                <Badge variant="outline">{KIND_LABEL[n.kind]}</Badge>
                <Badge variant={n.connection.status === "connected" ? "default" : "secondary"}>{CONNECTION_STATUS_LABEL[n.connection.status]}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={n.kind}
                  aria-label={`Tipo del número de ${n.userName}`}
                  disabled={busy}
                  onChange={(e) => void send(url, "PATCH", { kind: e.target.value })}
                  className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                >
                  <option value="personal">{KIND_LABEL.personal}</option>
                  <option value="empresa" disabled={lockedPersonal}>
                    {KIND_LABEL.empresa}
                  </option>
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(MI_NUMERO_TEXT.revokeConfirm(n.userName))) void send(url, "DELETE");
                  }}
                >
                  Revocar
                </Button>
                {lockedPersonal && (
                  <span className="text-xs text-text-3">Para hacerlo de la empresa, la persona lo acepta desde su «Mi número».</span>
                )}
              </div>
              {n.kind === "empresa" && (
                <div className="divide-y rounded-md border px-3">
                  {SWITCH_ORDER.map((key) => (
                    <div key={key} className="flex items-center justify-between gap-4 py-2">
                      <span className="text-sm">{SWITCH_TEXT[key].title}</span>
                      <Switch
                        size="sm"
                        checked={n.switches[key]}
                        label={`${SWITCH_TEXT[key].title} (${n.userName})`}
                        disabled={busy}
                        onCheckedChange={(next) => void send(url, "PATCH", { [key]: next })}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
