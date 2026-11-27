"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActionsLog } from "./actions-log";
import { Switch } from "@/components/ui/switch";
import { ADVANCED_AREA_TEXT, ADVANCED_AREAS, type AdvancedArea } from "@/lib/ai-connector";
import { fetchJson, jsonInit } from "@/lib/fetch-json";

type Advanced = { enabled: boolean; roles: "coordinador"[]; areas: AdvancedArea[]; launchCampaigns: boolean };
type Settings = {
  enabled: boolean;
  allowedRoles: ("coordinador" | "asesor")[];
  dailyMessageLimit: number;
  advanced: Advanced;
};

const ROLES: { key: "coordinador" | "asesor"; label: string }[] = [
  { key: "coordinador", label: "Coordinadores" },
  { key: "asesor", label: "Asesores" },
];

/**
 * 047 PR 3 — Ajustes → IA conectada → Ajustes del conector (Propietario):
 * encender, qué roles pueden conectar su IA y el tope diario de mensajes.
 * PR 6: «Funciones avanzadas» (apagadas) con sus áreas y «Puede lanzar campañas».
 */
export function ConnectorSettingsClient() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetchJson<{ settings: Settings }>("/api/settings/ai-connector");
      if (!res.ok) return setError(res.error);
      setS(res.data.settings);
      setSaved(res.data.settings);
    })();
  }, []);

  async function save() {
    if (!s) return;
    setBusy(true);
    const res = await fetchJson<{ settings: Settings }>("/api/settings/ai-connector", jsonInit("PUT", s));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setS(res.data.settings);
    setSaved(res.data.settings);
  }

  if (!s) return <p className="text-sm text-muted-foreground">{error ?? "Cargando…"}</p>;
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const toggleRole = (r: "coordinador" | "asesor", on: boolean) =>
    setS({ ...s, allowedRoles: on ? [...s.allowedRoles, r] : s.allowedRoles.filter((x) => x !== r) });
  const adv = s.advanced;
  const setAdv = (next: Partial<Advanced>) => setS({ ...s, advanced: { ...adv, ...next } });
  const toggleArea = (a: AdvancedArea, on: boolean) =>
    setAdv({ areas: on ? [...adv.areas, a] : adv.areas.filter((x) => x !== a) });
  const advOff = !s.enabled || !adv.enabled;

  const rowCls = "flex items-center justify-between gap-3 border-t border-border py-3 text-sm first:border-t-0";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[min(100%,16rem)] flex-1 space-y-1">
          <h2 className="text-[22px] font-semibold tracking-tight max-lg:hidden">Conector del equipo</h2>
          <p className="text-[13.5px] leading-relaxed text-text-2">
            Decide si tu equipo puede conectar su propia IA y qué puede hacer. La IA entra con la cuenta de cada
            persona y nunca ve chats privados de «Mi número». Cada quien paga su IA.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
          {s.enabled ? "Encendido" : "Apagado"}
          <Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} label="Conector de IA" />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="text-sm">¿Quiénes pueden conectar su IA?</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <div className={rowCls}>
              <span>
                <span className="block font-medium">Propietario</span>
                <span className="block text-xs text-text-3">Tú siempre puedes.</span>
              </span>
              <span className="rounded-full bg-success-tint px-2 py-0.5 text-xs text-success-text">Siempre</span>
            </div>
            {ROLES.map((r) => (
              <label key={r.key} className={rowCls}>
                <span className="font-medium">{r.label}</span>
                <Switch
                  size="sm"
                  checked={s.allowedRoles.includes(r.key)}
                  onCheckedChange={(v) => toggleRole(r.key, v)}
                  label={r.label}
                  disabled={!s.enabled}
                />
              </label>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-border">
            <CardTitle className="text-sm">¿Qué puede hacer?</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <div className={rowCls}>
              <span>
                <span className="block font-medium">Mensajes a clientes por persona al día</span>
                <span className="block text-xs text-text-3">Con 0, la IA solo lee y propone; no envía nada.</span>
              </span>
              <Input
                id="ai-daily-limit"
                aria-label="Mensajes a clientes por persona al día"
                type="number"
                min={0}
                max={1000}
                className="w-20 text-center"
                value={s.dailyMessageLimit}
                disabled={!s.enabled}
                onChange={(e) => setS({ ...s, dailyMessageLimit: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="ai-advanced">
        <CardHeader className="border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm">Funciones avanzadas</CardTitle>
              <CardDescription>
                Tareas de administración. Apagadas, la IA solo atiende chats. Cada persona sigue limitada a lo que su
                rol puede hacer. Tú siempre; los Asesores, nunca.
              </CardDescription>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                También los Coordinadores
                <Switch
                  size="sm"
                  checked={adv.roles.includes("coordinador")}
                  onCheckedChange={(v) => setAdv({ roles: v ? ["coordinador"] : [] })}
                  label="También los Coordinadores"
                  disabled={advOff}
                />
              </label>
              <label className="flex items-center gap-2 font-medium">
                {adv.enabled ? "Encendidas" : "Apagadas"}
                <Switch
                  checked={adv.enabled}
                  onCheckedChange={(v) => setAdv({ enabled: v })}
                  label="Funciones avanzadas"
                  disabled={!s.enabled}
                />
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-3">
          {ADVANCED_AREAS.map((a) => (
            <label key={a} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">{ADVANCED_AREA_TEXT[a].label}</span>
                <span className="block text-xs text-text-3">{ADVANCED_AREA_TEXT[a].hint}</span>
              </span>
              <Switch
                size="sm"
                checked={adv.areas.includes(a)}
                onCheckedChange={(v) => toggleArea(a, v)}
                label={ADVANCED_AREA_TEXT[a].label}
                disabled={advOff}
              />
            </label>
          ))}
          <label className="flex items-center justify-between gap-3 rounded-lg border border-warning-soft bg-warning-tint px-3 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="block font-medium">Puede lanzar campañas</span>
              <span className="block text-xs text-text-2">
                Apagado, la IA deja la campaña lista y una persona la lanza.
              </span>
            </span>
            <Switch
              size="sm"
              checked={adv.launchCampaigns}
              onCheckedChange={(v) => setAdv({ launchCampaigns: v })}
              label="Puede lanzar campañas"
              disabled={advOff || !adv.areas.includes("campaigns")}
            />
          </label>
        </CardContent>
      </Card>

      <p className="rounded-lg border border-warning-soft bg-warning-tint px-4 py-3 text-sm text-text-2">
        <span className="font-semibold">Lo que la IA nunca puede hacer:</span> borrar chats o contactos, tocar la
        conexión de WhatsApp, cambiar roles, el equipo o las llaves, ni leer chats privados de «Mi número» de otra
        persona.
      </p>

      <div className="space-y-2">
        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
        <Button disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? "Guardando…" : "Guardar"}
        </Button>
      </div>

      <ActionsLog
        team
        url="/api/settings/ai-connector/activity"
        title="Qué hizo la IA del equipo"
        description="Lo que pidió la IA de cada persona, la más reciente primero. Nunca el texto de los mensajes; los chats privados de «Mi número» salen sin nombre."
      />
    </div>
  );
}
