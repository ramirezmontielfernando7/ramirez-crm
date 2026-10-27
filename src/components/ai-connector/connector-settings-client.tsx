"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fetchJson, jsonInit } from "@/lib/fetch-json";

type Settings = { enabled: boolean; allowedRoles: ("coordinador" | "asesor")[]; dailyMessageLimit: number };

const ROLES: { key: "coordinador" | "asesor"; label: string }[] = [
  { key: "coordinador", label: "Coordinadores" },
  { key: "asesor", label: "Asesores" },
];

/**
 * 047 PR 3 — Ajustes → IA conectada → Ajustes del conector (Propietario):
 * encender, qué roles pueden conectar su IA y el tope diario de mensajes.
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

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Cada persona puede conectar su propia IA (Claude, ChatGPT u otra) para que trabaje por ella en Dashfort. La IA
        entra con la cuenta de esa persona: ve y hace solo lo que esa persona puede, y nunca ve chats privados de «Mi
        número». Cada quien paga su IA; a tu negocio no le cuesta.
      </p>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Conector de IA</CardTitle>
              <CardDescription>Apagado, nadie puede conectar su IA y las conectadas dejan de entrar.</CardDescription>
            </div>
            <Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} label="Conector de IA" />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium">¿Quiénes pueden conectar su IA?</p>
            <p className="text-xs text-text-3">Tú, como Propietario, siempre puedes.</p>
            {ROLES.map((r) => (
              <label key={r.key} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                <span>{r.label}</span>
                <Switch
                  size="sm"
                  checked={s.allowedRoles.includes(r.key)}
                  onCheckedChange={(v) => toggleRole(r.key, v)}
                  label={r.label}
                  disabled={!s.enabled}
                />
              </label>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-daily-limit">Mensajes a clientes por persona al día</Label>
            <Input
              id="ai-daily-limit"
              type="number"
              min={0}
              max={1000}
              className="w-32"
              value={s.dailyMessageLimit}
              disabled={!s.enabled}
              onChange={(e) => setS({ ...s, dailyMessageLimit: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })}
            />
            <p className="text-xs text-text-3">Con 0, la IA solo lee y propone; no envía nada.</p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          )}
          <Button disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lo que la IA nunca puede hacer</CardTitle>
          <CardDescription>
            Exportar contactos, mandar campañas, borrar chats o contactos, cambiar ajustes, roles o conexiones de
            WhatsApp. Esas herramientas no existen en el conector.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
