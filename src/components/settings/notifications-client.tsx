"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { playChime } from "@/components/team-chat/unread-store";
import { savePrefs, useNotifPrefs } from "@/components/notifications/notification-store";
import {
  NOTIF_KINDS,
  NOTIF_KIND_LABEL,
  TONES,
  TONE_LABEL,
  minutesLabel,
  parseMinutes,
  type ChannelPref,
  type NotifKind,
  type NotifPrefs,
} from "@/lib/notification-prefs";
import { SettingsHeader } from "@/components/settings/settings-header";

type Perm = "granted" | "denied" | "default" | "unsupported";

function currentPerm(): Perm {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/**
 * Ajustes → Personalización → Notificaciones. Preferencias de ESTE navegador
 * (cada persona elige las suyas): sonido, tono, volumen, avisos del sistema y
 * «No molestar». Lo que avisa se decide en `lib/notification-prefs.ts`.
 */
export function NotificationsClient() {
  const prefs = useNotifPrefs();
  const [perm, setPerm] = useState<Perm>("unsupported");
  useEffect(() => setPerm(currentPerm()), []);

  const update = (patch: Partial<NotifPrefs>) => savePrefs({ ...prefs, ...patch });
  const setRule = (kind: NotifKind, patch: Partial<ChannelPref>) =>
    savePrefs({ ...prefs, rules: { ...prefs.rules, [kind]: { ...prefs.rules[kind], ...patch } } });

  async function askPermission() {
    if (typeof Notification === "undefined") return;
    setPerm((await Notification.requestPermission()) as Perm);
  }

  function testSystem() {
    try {
      new Notification("Dashfort", { body: "Así se ven tus avisos del sistema." });
    } catch {
      // Sin soporte en este navegador.
    }
  }

  return (
    <div data-pm="notifications" className="space-y-6">
      <SettingsHeader title="Notificaciones" description="Cómo y cuándo te avisa Dashfort. Es solo tuyo y de este navegador." />
      <Card>
        <CardHeader>
          <CardTitle>Sonido</CardTitle>
          <CardDescription>Un tono corto cuando llega un aviso. Solo suena en este navegador.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch checked={prefs.sound} onCheckedChange={(v) => update({ sound: v })} label="Sonido de avisos" />
            <span className="text-sm font-medium">{prefs.sound ? "Encendido" : "Apagado"}</span>
          </div>
          <fieldset className="flex flex-wrap gap-2" disabled={!prefs.sound}>
            <legend className="sr-only">Tono</legend>
            {TONES.map((t) => (
              <label
                key={t}
                className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:disabled]:opacity-50"
              >
                <input
                  type="radio"
                  name="tone"
                  checked={prefs.tone === t}
                  onChange={() => update({ tone: t })}
                  className="accent-[var(--brand)]"
                />
                {TONE_LABEL[t]}
                <button
                  type="button"
                  aria-label={`Escuchar ${TONE_LABEL[t]}`}
                  onClick={(e) => {
                    e.preventDefault();
                    playChime({ tone: t, volume: prefs.volume });
                  }}
                  className="rounded p-0.5 text-text-3 hover:text-foreground"
                >
                  <Play className="h-3.5 w-3.5" strokeWidth={1.8} />
                </button>
              </label>
            ))}
          </fieldset>
          <div className="flex items-center gap-3">
            <label htmlFor="notif-volume" className="w-16 text-sm text-text-2">
              Volumen
            </label>
            <input
              id="notif-volume"
              type="range"
              min={0}
              max={100}
              value={Math.round(prefs.volume * 100)}
              disabled={!prefs.sound}
              onChange={(e) => update({ volume: Number(e.target.value) / 100 })}
              className="w-56 accent-[var(--brand)]"
            />
            <Button variant="outline" size="sm" onClick={() => playChime({ tone: prefs.tone, volume: prefs.volume })}>
              Probar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Avisos del sistema</CardTitle>
          <CardDescription>
            Un aviso de tu computadora o teléfono cuando Dashfort está en segundo plano.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          {perm === "unsupported" && <span className="text-text-2">Este navegador no los permite.</span>}
          {perm === "default" && <Button onClick={() => void askPermission()}>Permitir avisos del sistema</Button>}
          {perm === "denied" && (
            <span className="text-text-2">
              Los bloqueaste en el navegador. Actívalos desde el candado junto a la dirección.
            </span>
          )}
          {perm === "granted" && (
            <>
              <span className="rounded-full bg-success-tint px-2.5 py-0.5 text-xs font-semibold text-success-text">
                Permitidos
              </span>
              <Button variant="outline" size="sm" onClick={testSystem}>
                Enviar aviso de prueba
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Avisarme cuando…</CardTitle>
          <CardDescription>Elige dónde quieres enterarte de cada cosa.</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm" data-pm="notif-rules">
            <thead>
              <tr className="text-left text-xs text-text-3">
                <th className="py-1.5 font-medium">Evento</th>
                <th className="w-28 py-1.5 text-center font-medium">En Avisos</th>
                <th className="w-28 py-1.5 text-center font-medium">Con sonido</th>
                <th className="w-32 py-1.5 text-center font-medium">Aviso del sistema</th>
              </tr>
            </thead>
            <tbody>
              {NOTIF_KINDS.map((k) => (
                <tr key={k} className="border-t">
                  <td className="py-2.5">{NOTIF_KIND_LABEL[k]}</td>
                  {(["inApp", "sound", "system"] as const).map((c) => (
                    <td key={c} className="py-2.5 text-center">
                      <Switch
                        size="sm"
                        checked={prefs.rules[k][c]}
                        onCheckedChange={(v) => setRule(k, { [c]: v })}
                        label={`${NOTIF_KIND_LABEL[k]}: ${c === "inApp" ? "en Avisos" : c === "sound" ? "con sonido" : "aviso del sistema"}`}
                        className="mx-auto"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>No molestar</CardTitle>
          <CardDescription>En este horario no suena nada ni salen avisos del sistema. Siguen en Avisos.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          <Switch
            checked={prefs.quiet.on}
            onCheckedChange={(v) => update({ quiet: { ...prefs.quiet, on: v } })}
            label="No molestar"
          />
          <span>De</span>
          <input
            type="time"
            aria-label="Desde"
            value={minutesLabel(prefs.quiet.from)}
            disabled={!prefs.quiet.on}
            onChange={(e) => {
              const v = parseMinutes(e.target.value);
              if (v != null) update({ quiet: { ...prefs.quiet, from: v } });
            }}
            className="rounded-md border bg-background px-2 py-1 disabled:opacity-50"
          />
          <span>a</span>
          <input
            type="time"
            aria-label="Hasta"
            value={minutesLabel(prefs.quiet.to)}
            disabled={!prefs.quiet.on}
            onChange={(e) => {
              const v = parseMinutes(e.target.value);
              if (v != null) update({ quiet: { ...prefs.quiet, to: v } });
            }}
            className="rounded-md border bg-background px-2 py-1 disabled:opacity-50"
          />
        </CardContent>
      </Card>
    </div>
  );
}
