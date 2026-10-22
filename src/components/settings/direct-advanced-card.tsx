"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DIRECT_TEXT, MODE_PICKER_TEXT, type ConnectionMode } from "@/lib/direct-connection";

type Advanced = {
  defaultMode: ConnectionMode;
  autoReturnToMeta: boolean;
  preferMetaInWindow: boolean;
  closedWindowMode: "directa" | "mixta";
  limitsEnabled: boolean;
  minIntervalSeconds: number;
  perChatPerMinute: number;
  perHour: number;
};
type Ranges = Record<"minIntervalSeconds" | "perChatPerMinute" | "perHour", { min: number; max: number }>;

const SELECT_CLASS = "h-9 w-full rounded-md border bg-background px-3 text-sm";

/**
 * Conexión directa (PR 5) — «Avanzado» en Ajustes: modo por defecto, regreso
 * automático a Oficial, el ajuste opcional por ventana de 24 h y los límites
 * de envío (editables o apagables).
 */
export function DirectAdvancedCard() {
  const [data, setData] = useState<Advanced | null>(null);
  const [ranges, setRanges] = useState<Ranges | null>(null);
  const [hint, setHint] = useState("");
  const [metaless, setMetaless] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/settings/direct-connection/advanced").catch(() => null);
      if (!r?.ok) return;
      const body = (await r.json()) as { advanced: Advanced; ranges: Ranges; hint: string; metaless?: boolean };
      setData(body.advanced);
      setRanges(body.ranges);
      setHint(body.hint);
      setMetaless(body.metaless === true);
    })();
  }, []);

  if (!data || !ranges) return null;
  const set = <K extends keyof Advanced>(key: K, value: Advanced[K]) => setData({ ...data, [key]: value });
  const num = (key: "minIntervalSeconds" | "perChatPerMinute" | "perHour", label: string, unit: string) => (
    <div className="space-y-1">
      <Label htmlFor={`adv-${key}`}>{label}</Label>
      <Input
        id={`adv-${key}`}
        type="number"
        inputMode="numeric"
        min={ranges[key].min}
        max={ranges[key].max}
        value={Number.isFinite(data[key]) ? data[key] : ""}
        disabled={!data.limitsEnabled}
        onChange={(e) => set(key, e.target.value === "" ? Number.NaN : Number(e.target.value))}
      />
      <p className="text-xs text-muted-foreground">
        {unit} · de {ranges[key].min} a {ranges[key].max}
      </p>
    </div>
  );

  async function save() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/settings/direct-connection/advanced", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    }).catch(() => null);
    setBusy(false);
    if (!r) return setMsg({ ok: false, text: "Sin conexión. Intenta de nuevo." });
    if (!r.ok) {
      const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setMsg({ ok: false, text: body?.error?.message ?? "No se pudo guardar." });
    }
    const body = (await r.json()) as { advanced: Advanced };
    setData(body.advanced);
    setMsg({ ok: true, text: "Guardado." });
  }

  return (
    <Card data-testid="direct-advanced">
      <CardHeader>
        <CardTitle>Avanzado</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {metaless ? (
          <p className="text-sm text-muted-foreground" data-testid="direct-advanced-metaless">
            {DIRECT_TEXT.metalessNote}
          </p>
        ) : (
          <>
            <div className="space-y-1">
              <Label htmlFor="adv-default">Modo de los chats nuevos</Label>
              <select
                id="adv-default"
                className={SELECT_CLASS}
                value={data.defaultMode}
                onChange={(e) => set("defaultMode", e.target.value as ConnectionMode)}
              >
                <option value="meta">{MODE_PICKER_TEXT.meta.label}</option>
                <option value="directa">{MODE_PICKER_TEXT.directa.label}</option>
                <option value="mixta">{`${MODE_PICKER_TEXT.directa.label} · ${DIRECT_TEXT.receiveViaMeta}`}</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Volver a Oficial cuando el contacto escribe</p>
                <p className="text-xs text-muted-foreground">{MODE_PICKER_TEXT.autoReturn}</p>
              </div>
              <Switch label="Volver a Oficial cuando el contacto escribe" checked={data.autoReturnToMeta} onCheckedChange={(v) => set("autoReturnToMeta", v)} />
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Ajuste por ventana de 24 h (opcional)</p>
                  <p className="text-xs text-muted-foreground">Usar Oficial mientras la ventana de 24 h esté abierta.</p>
                </div>
                <Switch label="Usar Oficial con la ventana abierta" checked={data.preferMetaInWindow} onCheckedChange={(v) => set("preferMetaInWindow", v)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="adv-closed">Con la ventana cerrada, «{DIRECT_TEXT.continueDirect}» deja el chat en</Label>
                <select
                  id="adv-closed"
                  className={SELECT_CLASS}
                  value={data.closedWindowMode}
                  onChange={(e) => set("closedWindowMode", e.target.value as "directa" | "mixta")}
                >
                  <option value="mixta">{`${MODE_PICKER_TEXT.directa.label} · ${DIRECT_TEXT.receiveViaMeta}`}</option>
                  <option value="directa">{MODE_PICKER_TEXT.directa.label}</option>
                </select>
              </div>
            </div>

          </>
        )}

        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Límites de envío</p>
              <p className="text-xs text-muted-foreground">Enviar despacio protege tu número. Puedes ajustarlos o apagarlos.</p>
            </div>
            <Switch label="Límites de envío" checked={data.limitsEnabled} onCheckedChange={(v) => set("limitsEnabled", v)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {num("minIntervalSeconds", "Espera entre mensajes", "segundos")}
            {num("perChatPerMinute", "Por chat, por minuto", "mensajes")}
            {num("perHour", "Por hora, en total", "mensajes")}
          </div>
        </div>

        {msg && (
          <p className={msg.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"} role={msg.ok ? "status" : "alert"}>
            {msg.text}
          </p>
        )}
        <Button onClick={() => void save()} disabled={busy} data-testid="direct-advanced-save">
          Guardar
        </Button>
      </CardContent>
    </Card>
  );
}
