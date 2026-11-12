"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/fetch-json";
import {
  FORGOTTEN_HOURS_OPTIONS,
  MAX_AUTO_TEXT_LENGTH,
  WEEKDAYS,
  WEEKDAY_LABEL,
  type AutoHours,
} from "@/lib/auto-replies";

type Settings = {
  welcomeEnabled: boolean;
  welcomeText: string | null;
  awayEnabled: boolean;
  awayText: string | null;
  hours: AutoHours;
  timezone: string;
  forgottenAlertHours: number | null;
};

const ZONES = [
  ["America/Mexico_City", "Centro de México (CDMX)"],
  ["America/Monterrey", "Monterrey"],
  ["America/Cancun", "Cancún"],
  ["America/Mazatlan", "Mazatlán / Chihuahua"],
  ["America/Tijuana", "Tijuana"],
  ["America/Bogota", "Bogotá"],
  ["America/Lima", "Lima"],
  ["America/Santiago", "Santiago"],
  ["America/Argentina/Buenos_Aires", "Buenos Aires"],
  ["America/New_York", "Nueva York"],
  ["America/Los_Angeles", "Los Ángeles"],
  ["Europe/Madrid", "Madrid"],
] as const;

/**
 * 049 — Mensajes automáticos SIN IA: bienvenida, fuera de horario (con el
 * horario del negocio) y el aviso de chats olvidados. Todo apagado de fábrica.
 */
export function AutoRepliesSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetchJson<{ settings: Settings }>("/api/settings/auto-replies");
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSettings(res.data.settings);
    })();
  }, []);

  if (!settings) {
    return error ? <p className="text-sm text-danger-text">{error}</p> : null;
  }

  const update = (patch: Partial<Settings>) => {
    setSaved(false);
    setSettings({ ...settings, ...patch });
  };

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetchJson<{ settings: Settings }>("/api/settings/auto-replies", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSettings(res.data.settings);
    setSaved(true);
  }

  const zoneKnown = ZONES.some(([z]) => z === settings.timezone);

  return (
    <div className="space-y-4" data-testid="auto-replies-settings">
      <Card>
        <CardHeader>
          <CardTitle>Horario del negocio</CardTitle>
          <CardDescription>
            Lo usan el mensaje de «fuera de horario» y el aviso de chats olvidados. Si tu agente de IA está
            encendido, él contesta a cualquier hora y estos mensajes no se mandan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2">
            {WEEKDAYS.map((d) => {
              const h = settings.hours[d];
              return (
                <li key={d} className="flex flex-wrap items-center gap-3">
                  <Switch
                    checked={h.open}
                    onCheckedChange={(v) => update({ hours: { ...settings.hours, [d]: { ...h, open: v } } })}
                    label={`${WEEKDAY_LABEL[d]}: abierto`}
                  />
                  <span className="w-24 text-sm">{WEEKDAY_LABEL[d]}</span>
                  {h.open ? (
                    <span className="flex items-center gap-2 text-sm">
                      <Input
                        type="time"
                        aria-label={`${WEEKDAY_LABEL[d]}: abre`}
                        className="w-32"
                        value={h.from}
                        onChange={(e) => update({ hours: { ...settings.hours, [d]: { ...h, from: e.target.value } } })}
                      />
                      a
                      <Input
                        type="time"
                        aria-label={`${WEEKDAY_LABEL[d]}: cierra`}
                        className="w-32"
                        value={h.to}
                        onChange={(e) => update({ hours: { ...settings.hours, [d]: { ...h, to: e.target.value } } })}
                      />
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">Cerrado</span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor="auto-tz">Zona horaria</Label>
            <select
              id="auto-tz"
              className="h-9 w-full max-w-xs rounded-md border border-input bg-card px-2 text-sm"
              value={settings.timezone}
              onChange={(e) => update({ timezone: e.target.value })}
            >
              {!zoneKnown && <option value={settings.timezone}>{settings.timezone}</option>}
              {ZONES.map(([z, label]) => (
                <option key={z} value={z}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bienvenida</CardTitle>
          <CardDescription>
            Se manda una sola vez, cuando alguien te escribe por primera vez. No sale si el chat nació de una
            campaña, ni si ya le contestaron.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={settings.welcomeEnabled}
              onCheckedChange={(v) => update({ welcomeEnabled: v })}
              label="Mandar mensaje de bienvenida"
            />
            <span className="text-sm">Mandar mensaje de bienvenida</span>
          </div>
          <Textarea
            aria-label="Texto de la bienvenida"
            rows={3}
            maxLength={MAX_AUTO_TEXT_LENGTH}
            placeholder="¡Hola {nombre}! Gracias por escribirnos. En un momento te atiende una persona del equipo."
            value={settings.welcomeText ?? ""}
            disabled={!settings.welcomeEnabled}
            onChange={(e) => update({ welcomeText: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Puedes escribir <code>{"{nombre}"}</code> y se cambia por el nombre del cliente.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fuera de horario</CardTitle>
          <CardDescription>
            Si te escriben con el negocio cerrado, se les avisa. Como mucho una vez cada 12 horas por chat; si
            es un chat nuevo, sale este mensaje y no la bienvenida.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={settings.awayEnabled}
              onCheckedChange={(v) => update({ awayEnabled: v })}
              label="Avisar cuando está cerrado"
            />
            <span className="text-sm">Avisar cuando el negocio está cerrado</span>
          </div>
          <Textarea
            aria-label="Texto de fuera de horario"
            rows={3}
            maxLength={MAX_AUTO_TEXT_LENGTH}
            placeholder="Hola, ahorita estamos fuera de horario. Te respondemos en cuanto abramos."
            value={settings.awayText ?? ""}
            disabled={!settings.awayEnabled}
            onChange={(e) => update({ awayText: e.target.value })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chats olvidados</CardTitle>
          <CardDescription>
            Si un cliente lleva mucho sin respuesta, le avisamos al asesor asignado (y a quien ve todo, si no
            hay asesor). Solo avisa dentro del horario del negocio. Los mensajes automáticos no cuentan como
            respuesta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="forgotten-hours">Avisar cuando un chat lleve sin respuesta</Label>
          <select
            id="forgotten-hours"
            className="h-9 w-full max-w-xs rounded-md border border-input bg-card px-2 text-sm"
            value={settings.forgottenAlertHours ?? ""}
            onChange={(e) => update({ forgottenAlertHours: e.target.value === "" ? null : Number(e.target.value) })}
          >
            <option value="">No avisar</option>
            {FORGOTTEN_HOURS_OPTIONS.map((h) => (
              <option key={h} value={h}>
                {h === 1 ? "1 hora" : `${h} horas`}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-danger-text">{error}</p>}
      {saved && <p className="text-sm text-success-text">Guardado.</p>}
      <Button onClick={() => void save()} disabled={busy}>
        {busy ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  );
}
