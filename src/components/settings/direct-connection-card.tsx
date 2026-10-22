"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CONNECTION_STATUS_LABEL, DIRECT_TEXT, type DirectConnectionStatus } from "@/lib/direct-connection";

type Connection = {
  status: DirectConnectionStatus;
  phoneNumber: string | null;
  connectedAt: string | null;
  pausedUntil: string | null;
  canLink: boolean;
};
type Qr = { image: string | null; pairingCode: string | null };

const POLL_MS = 3000;

/**
 * Conexión directa (PR 2) — Vincular el número por QR dentro de Ajustes, ver
 * si está conectado, reconectar y desvincular. Nunca nombra el servidor.
 */
export function DirectConnectionCard() {
  const [conn, setConn] = useState<Connection | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/settings/direct-connection").catch(() => null);
    if (!r?.ok) return;
    const { connection } = (await r.json()) as { connection: Connection };
    setConn(connection);
    if (connection.status === "connected") setQr(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Mientras se espera el escaneo, se pregunta cada 3 s.
  useEffect(() => {
    if (conn?.status === "connecting") {
      timer.current = setInterval(() => void refresh(), POLL_MS);
      return () => {
        if (timer.current) clearInterval(timer.current);
      };
    }
  }, [conn?.status, refresh]);

  async function act(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/settings/direct-connection", { method }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Sin conexión. Intenta de nuevo.");
    if (!r.ok) {
      const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setError(body?.error?.message ?? "No se pudo completar la acción.");
    }
    if (method === "POST") {
      const body = (await r.json()) as { qr: Qr | null };
      setQr(body.qr);
    } else {
      setQr(null);
    }
    await refresh();
  }

  if (!conn) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  const connected = conn.status === "connected";
  const paused = conn.pausedUntil !== null;
  return (
    <div className="max-w-3xl space-y-6" data-testid="direct-connection">
      {conn.status === "disconnected" && (
        <div className="rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm" role="alert" data-testid="direct-disconnected">
          {DIRECT_TEXT.disconnected}
        </div>
      )}
      {paused && (
        <div className="rounded-lg border bg-card p-4 text-sm" role="status">
          {DIRECT_TEXT.emergencyPause}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {DIRECT_TEXT.moduleName}
            <Badge variant={connected ? "default" : "secondary"} data-testid="direct-status">
              {CONNECTION_STATUS_LABEL[conn.status]}
            </Badge>
          </CardTitle>
          <CardDescription>{DIRECT_TEXT.activationNotice}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {connected && (
            <p className="text-sm">
              {DIRECT_TEXT.device}
              {conn.phoneNumber ? `: +${conn.phoneNumber}` : ""}
            </p>
          )}
          {qr && !connected && (
            <div className="space-y-2" data-testid="direct-qr">
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
          <div className="flex flex-wrap gap-2">
            {!connected && (
              <Button onClick={() => void act("POST")} disabled={busy || paused || !conn.canLink} data-testid="direct-link">
                {conn.status === "connecting" || conn.status === "disconnected" ? "Mostrar código de nuevo" : DIRECT_TEXT.linkDevice}
              </Button>
            )}
            {connected && (
              <Button variant="outline" onClick={() => void act("POST")} disabled={busy}>
                Reconectar
              </Button>
            )}
            {conn.status !== "pending" && (
              <Button
                variant="outline"
                disabled={busy}
                data-testid="direct-unlink"
                onClick={() => {
                  if (window.confirm("¿Desvincular el dispositivo? Dejarás de enviar por conexión directa.")) void act("DELETE");
                }}
              >
                Desvincular
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
