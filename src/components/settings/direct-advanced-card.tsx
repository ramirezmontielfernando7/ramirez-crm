"use client";

import { useEffect, useState } from "react";
import { modeDotClass } from "@/components/inbox/chat-mode-dot";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CONNECTION_MODES, DIRECT_TEXT, MODE_PICKER_TEXT, type ConnectionMode } from "@/lib/direct-connection";
import { cn } from "@/lib/utils";

type Advanced = {
  defaultMode: ConnectionMode;
  autoReturnToMeta: boolean;
  preferMetaInWindow: boolean;
  /** Ya no se muestra (Fer, 26 oct): viaja tal cual para no perderlo al guardar. */
  closedWindowMode: "directa" | "mixta";
  limitsEnabled: boolean;
  minIntervalSeconds: number;
  perChatPerMinute: number;
  perHour: number;
};
type Ranges = Record<"minIntervalSeconds" | "perChatPerMinute" | "perHour", { min: number; max: number }>;
type Msg = { ok: boolean; text: string } | null;

async function errorText(r: Response | null, fallback: string): Promise<string> {
  if (!r) return "Sin conexión. Intenta de nuevo.";
  const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

/**
 * Conexión directa — Bloques 2 a 4 de Ajustes (Fer, 26 oct: «confuso y
 * redundante»): 2 el modo de los chats nuevos en tres tarjetas, con «Aplicar
 * a todos»; 3 los dos cambios automáticos; 4 los límites de envío, plegados
 * con su resumen.
 */
export function DirectAdvancedCard({ canApplyAll }: { canApplyAll: boolean }) {
  const [data, setData] = useState<Advanced | null>(null);
  const [ranges, setRanges] = useState<Ranges | null>(null);
  const [hint, setHint] = useState("");
  const [metaless, setMetaless] = useState(false);
  const [chats, setChats] = useState<number | null>(null);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [applyMsg, setApplyMsg] = useState<Msg>(null);

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

  useEffect(() => {
    if (!canApplyAll || metaless) return;
    void (async () => {
      const r = await fetch("/api/settings/direct-connection/apply-all").catch(() => null);
      if (r?.ok) setChats(((await r.json()) as { chats: number }).chats);
    })();
  }, [canApplyAll, metaless]);

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

  /** Guarda todo. true = guardado. */
  async function save(): Promise<boolean> {
    const r = await fetch("/api/settings/direct-connection/advanced", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    }).catch(() => null);
    if (!r?.ok) {
      setMsg({ ok: false, text: await errorText(r, "No se pudo guardar.") });
      setLimitsOpen(true);
      return false;
    }
    setData(((await r.json()) as { advanced: Advanced }).advanced);
    return true;
  }

  async function onSave() {
    setBusy(true);
    setMsg(null);
    if (await save()) setMsg({ ok: true, text: "Guardado." });
    setBusy(false);
  }

  async function onApplyAll() {
    if (!data) return;
    const label = MODE_PICKER_TEXT[data.defaultMode].label;
    const warn =
      data.defaultMode !== "meta" && data.autoReturnToMeta
        ? "\n\nOjo: «Regresar a Meta cuando el cliente escribe» está encendido, así que cada chat volverá solo a Meta en cuanto el cliente conteste."
        : "";
    if (!window.confirm(`¿Poner todos los chats de WhatsApp en «${label}»?${warn}`)) return;
    setBusy(true);
    setApplyMsg(null);
    setMsg(null);
    // Un solo paso para Fer: guarda el modo de los chats nuevos y cambia los que ya existen.
    if (!(await save())) return setBusy(false);
    const r = await fetch("/api/settings/direct-connection/apply-all", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: data.defaultMode }),
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setApplyMsg({ ok: false, text: await errorText(r, "No se pudo aplicar.") });
    const { changed } = (await r.json()) as { changed: number };
    setApplyMsg({
      ok: true,
      text: changed === 0 ? `Todos tus chats ya estaban en «${label}».` : `Listo: ${changed} ${changed === 1 ? "chat cambió" : "chats cambiaron"} a «${label}».`,
    });
  }

  const limitsSummary = data.limitsEnabled
    ? `Activos: 1 cada ${data.minIntervalSeconds} s · ${data.perChatPerMinute} por chat/min · ${data.perHour} por hora`
    : "Apagados";

  return (
    <div className="space-y-4" data-testid="direct-advanced">
      {metaless ? (
        <Card>
          <CardHeader>
            <CardTitle>2 · ¿Por dónde van los chats?</CardTitle>
            <CardDescription data-testid="direct-advanced-metaless">{DIRECT_TEXT.metalessNote}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2 · ¿Por dónde van los chats?</CardTitle>
              <CardDescription>
                Elige el modo para los chats nuevos. Cada chat se puede cambiar después desde el punto de color de su foto.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Modo de los chats nuevos">
                {CONNECTION_MODES.map((m) => {
                  const on = data.defaultMode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      data-testid={`default-mode-${m}`}
                      onClick={() => set("defaultMode", m)}
                      className={cn(
                        "rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        on ? "border-foreground bg-accent ring-1 ring-foreground" : "hover:bg-accent"
                      )}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", modeDotClass(m))} />
                        {MODE_PICKER_TEXT[m].label}
                      </span>
                      <span className="mt-1.5 block text-xs text-muted-foreground">{MODE_PICKER_TEXT[m].hint}</span>
                    </button>
                  );
                })}
              </div>
              {canApplyAll && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 px-4 py-3" data-testid="direct-apply-all">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Aplicar a todos los chats</p>
                    <p className="text-xs text-muted-foreground">
                      Guarda este modo y pone en «{MODE_PICKER_TEXT[data.defaultMode].label}»{" "}
                      {chats === null ? "todos los chats" : `los ${chats} ${chats === 1 ? "chat" : "chats"}`} de WhatsApp que ya tienes.
                    </p>
                  </div>
                  <Button onClick={() => void onApplyAll()} disabled={busy} data-testid="direct-apply-all-button">
                    Aplicar a todos
                  </Button>
                  {applyMsg && (
                    <p
                      className={cn("w-full text-sm", applyMsg.ok ? "text-muted-foreground" : "text-destructive")}
                      role={applyMsg.ok ? "status" : "alert"}
                    >
                      {applyMsg.text}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3 · Cambios automáticos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Regresar a Meta cuando el cliente escribe</p>
                  <p className="text-xs text-muted-foreground">{MODE_PICKER_TEXT.autoReturn}</p>
                </div>
                <Switch
                  label="Regresar a Meta cuando el cliente escribe"
                  checked={data.autoReturnToMeta}
                  onCheckedChange={(v) => set("autoReturnToMeta", v)}
                />
              </div>
              <div className="border-t" />
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Usar Meta mientras la ventana de 24 h esté abierta</p>
                  <p className="text-xs text-muted-foreground">Dentro de las 24 h responde por Meta; al cerrarse, por el dispositivo.</p>
                </div>
                <Switch
                  label="Usar Meta mientras la ventana de 24 h esté abierta"
                  checked={data.preferMetaInWindow}
                  onCheckedChange={(v) => set("preferMetaInWindow", v)}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle>{metaless ? "3" : "4"} · Límites de envío</CardTitle>
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground"
            aria-expanded={limitsOpen}
            data-testid="direct-limits-toggle"
            onClick={() => setLimitsOpen((v) => !v)}
          >
            {limitsSummary} · {limitsOpen ? "Ocultar" : "Editar"}
          </button>
        </CardHeader>
        {limitsOpen && (
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">{hint}</p>
              <Switch label="Límites de envío" checked={data.limitsEnabled} onCheckedChange={(v) => set("limitsEnabled", v)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {num("minIntervalSeconds", "Espera entre mensajes", "segundos")}
              {num("perChatPerMinute", "Por chat, por minuto", "mensajes")}
              {num("perHour", "Por hora, en total", "mensajes")}
            </div>
          </CardContent>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => void onSave()} disabled={busy} data-testid="direct-advanced-save">
          Guardar
        </Button>
        {msg && (
          <p className={msg.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"} role={msg.ok ? "status" : "alert"}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
