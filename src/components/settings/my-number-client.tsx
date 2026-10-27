"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { CONNECTION_STATUS_LABEL, DIRECT_TEXT, type DirectConnectionStatus } from "@/lib/direct-connection";
import { useAccessOverview } from "@/components/inbox/my-number-access";
import { ACCESS_TEXT, KIND_LABEL, MI_NUMERO_TEXT, SWITCH_ORDER, SWITCH_TEXT, type NumberSwitch } from "@/lib/mi-numero";

type Connection = { status: DirectConnectionStatus; phoneNumber: string | null; pausedUntil: string | null; canLink?: boolean };
type MyNumber = {
  id: string;
  kind: "personal" | "empresa";
  label: string | null;
  switches: Record<NumberSwitch, boolean>;
  noticeAcceptedAt: string | null;
  connection: Connection;
  canEditSwitches: boolean;
};
type Qr = { image: string | null; pairingCode: string | null };

const POLL_MS = 3000;

async function errorOf(r: Response | null): Promise<string> {
  if (!r) return "Sin conexión. Intenta de nuevo.";
  const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? "No se pudo completar la acción.";
}

/**
 * Mi número (046), PR 3 — Los ajustes de la persona (maqueta aprobada):
 * 1 su número (aviso, QR, estado), 2 qué comparte (cuatro interruptores,
 * apagados de fábrica, con su explicación), 3 quién ha visto sus chats y
 * 4 qué pasa si deja la empresa.
 */
export function MyNumberClient() {
  const [mine, setMine] = useState<MyNumber | null | undefined>(undefined);
  const [qr, setQr] = useState<Qr | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { overview, reload: reloadAccess } = useAccessOverview();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/settings/my-number").catch(() => null);
    if (!r?.ok) return setMine(null);
    const { number } = (await r.json()) as { number: MyNumber | null };
    setMine(number);
    if (number?.connection.status === "connected") setQr(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const status = mine?.connection.status;
  useEffect(() => {
    if (status !== "connecting") return;
    const poll = async () => {
      const r = await fetch("/api/settings/my-number/link").catch(() => null);
      if (!r?.ok) return;
      const { connection } = (await r.json()) as { connection: Connection };
      setMine((m) => (m ? { ...m, connection } : m));
      if (connection.status === "connected") setQr(null);
    };
    timer.current = setInterval(() => void poll(), POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [status]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/settings/my-number", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setError(await errorOf(r));
    const { number } = (await r.json()) as { number: MyNumber | null };
    setMine(number);
  }

  async function link(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/settings/my-number/link", { method }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setError(await errorOf(r));
    if (method === "POST") setQr(((await r.json()) as { qr: Qr | null }).qr);
    else setQr(null);
    await load();
  }

  if (mine === undefined) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (mine === null) {
    return (
      <Card data-testid="my-number-none">
        <CardHeader>
          <CardTitle>Mi número</CardTitle>
          <CardDescription>
            Aún no tienes un número autorizado. Pídele a tu coordinador o al propietario de la cuenta que te dé uno.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const conn = mine.connection;
  const connected = conn.status === "connected";
  const paused = conn.pausedUntil !== null;
  const accepted = mine.noticeAcceptedAt !== null;

  return (
    <div className="max-w-3xl space-y-4" data-testid="my-number">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Mi número</h2>
        <p className="text-sm text-muted-foreground">{MI_NUMERO_TEXT.pageIntro}</p>
      </div>

      {conn.status === "disconnected" && (
        <div className="rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm" role="alert">
          {DIRECT_TEXT.disconnected}
        </div>
      )}
      {paused && (
        <div className="rounded-lg border bg-card p-4 text-sm" role="status">
          {DIRECT_TEXT.emergencyPause}
        </div>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-4 space-y-0">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex flex-wrap items-center gap-2">
              1 · Tu número
              <Badge variant={connected ? "default" : "secondary"} data-testid="my-number-status">
                {CONNECTION_STATUS_LABEL[conn.status]}
              </Badge>
              <Badge variant="outline" data-testid="my-number-kind">
                {KIND_LABEL[mine.kind]}
              </Badge>
            </CardTitle>
            <CardDescription>
              {connected
                ? conn.phoneNumber
                  ? `+${conn.phoneNumber}`
                  : "Conectado"
                : "Vincula tu WhatsApp escaneando un código, como en WhatsApp Web."}
            </CardDescription>
          </div>
          {accepted && (
            <div className="flex flex-wrap gap-2">
              {!connected && (
                <Button onClick={() => void link("POST")} disabled={busy || paused} data-testid="my-number-link">
                  {conn.status === "pending" ? "Vincular mi número" : "Mostrar código de nuevo"}
                </Button>
              )}
              {connected && (
                <Button variant="outline" onClick={() => void link("POST")} disabled={busy}>
                  Reconectar
                </Button>
              )}
              {conn.status !== "pending" && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm("¿Desvincular tu número? Dejarás de recibir y contestar sus chats aquí.")) void link("DELETE");
                  }}
                >
                  Desvincular
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        {(!accepted || (qr && !connected) || error) && (
          <CardContent className="space-y-4">
            {!accepted && (
              <div className="space-y-3 rounded-lg border bg-muted/40 p-4" data-testid="my-number-notice">
                <p className="text-sm font-semibold">{MI_NUMERO_TEXT.noticeTitle}</p>
                <ul className="list-disc space-y-1.5 pl-5 text-sm">
                  {MI_NUMERO_TEXT.notice.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                <Button onClick={() => void patch({ acceptNotice: true })} disabled={busy} data-testid="my-number-accept">
                  {MI_NUMERO_TEXT.noticeAccept}
                </Button>
              </div>
            )}
            {qr && !connected && (
              <div className="space-y-2" data-testid="my-number-qr">
                <p className="text-sm">En tu teléfono: WhatsApp → Dispositivos vinculados → Vincular un dispositivo, y escanea este código.</p>
                {qr.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr.image} alt="Código QR para vincular" className="h-56 w-56 rounded-md border bg-white p-2" />
                ) : (
                  <p className="text-sm text-muted-foreground">Preparando el código…</p>
                )}
                {qr.pairingCode && <p className="text-xs text-muted-foreground">Código para vincular sin escanear: {qr.pairingCode}</p>}
              </div>
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2 · ¿Qué compartes con la empresa?</CardTitle>
          <CardDescription>{mine.canEditSwitches ? MI_NUMERO_TEXT.personalOnly : MI_NUMERO_TEXT.companyDecides}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {SWITCH_ORDER.map((key) => {
            const on = mine.switches[key];
            const t = SWITCH_TEXT[key];
            return (
              <div key={key} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0" data-testid={`my-number-switch-${key}`}>
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="text-sm text-muted-foreground">{t.on}</p>
                  <p className="text-xs text-text-3">{t.off}</p>
                </div>
                <Switch
                  checked={on}
                  label={t.title}
                  disabled={busy || !mine.canEditSwitches}
                  onCheckedChange={(next) => void patch({ [key]: next })}
                />
              </div>
            );
          })}
          {mine.kind === "personal" && (
            <div className="pt-3">
              <button
                type="button"
                className="text-xs text-text-3 underline-offset-2 hover:underline"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(MI_NUMERO_TEXT.becomeCompanyConfirm)) void patch({ becomeCompany: true });
                }}
              >
                {MI_NUMERO_TEXT.becomeCompany}
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3 · Quién ha visto tus chats</CardTitle>
          <CardDescription>{MI_NUMERO_TEXT.viewsIntro}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {overview && overview.granted.length > 0 && (
            <div className="space-y-2" data-testid="my-number-grants">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{ACCESS_TEXT.grantsTitle}</p>
              {overview.granted.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                  <span>{ACCESS_TEXT.grantRow(g.userName, g.contactName)}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      const r = await fetch(`/api/my-number/access/${g.id}`, {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ action: "revoke" }),
                      }).catch(() => null);
                      setBusy(false);
                      if (!r?.ok) setError("No se pudo quitar el acceso. Intenta de nuevo.");
                      await reloadAccess();
                    }}
                  >
                    {ACCESS_TEXT.removeAccess}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {overview && overview.views.length > 0 ? (
            <ul className="divide-y rounded-md border text-sm" data-testid="my-number-views">
              {overview.views.map((v, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>{ACCESS_TEXT.viewRow(v.userName, v.contactName)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(v.viewedAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{MI_NUMERO_TEXT.noViews}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4 · Si dejas la empresa</CardTitle>
          <CardDescription>{MI_NUMERO_TEXT.leaving}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-text-3">{MI_NUMERO_TEXT.storage}</p>
        </CardContent>
      </Card>
    </div>
  );
}
