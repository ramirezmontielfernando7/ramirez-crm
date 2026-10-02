"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/lib/fetch-json";

type Settings = {
  stopKeywordsEnabled: boolean;
  stopKeywords: string[];
  stopReplyEnabled: boolean;
  stopReplyText: string | null;
  usageAlertPercent: number;
};

/**
 * Campañas v2 (PR 1) — Bajas por palabra clave (STOP/BAJA), su respuesta
 * automática (apagada por defecto) y el umbral de la alerta de uso del
 * límite de mensajería del número.
 */
export function OptOutSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [defaults, setDefaults] = useState<Settings | null>(null);
  const [keywordsText, setKeywordsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetchJson<{ settings: Settings; defaults: Settings }>("/api/settings/messaging");
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSettings(res.data.settings);
      setDefaults(res.data.defaults);
      setKeywordsText(res.data.settings.stopKeywords.join(", "));
    })();
  }, []);

  if (!settings) {
    return error ? <p className="text-sm text-danger-text">{error}</p> : null;
  }

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetchJson<{ settings: Settings }>("/api/settings/messaging", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...settings,
        stopKeywords: keywordsText.split(/[,\n]/),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSettings(res.data.settings);
    setKeywordsText(res.data.settings.stopKeywords.join(", "));
    setSaved(true);
  }

  return (
    <Card className="max-w-3xl" data-testid="opt-out-settings">
      <CardHeader>
        <CardTitle>Bajas por WhatsApp</CardTitle>
        <CardDescription>
          Si un cliente escribe SOLO una de estas palabras (por ejemplo «BAJA»), queda como «No acepta
          mensajes masivos» (opt_out), se anota en su línea de tiempo y ninguna campaña futura le llega.
          «Quiero cancelar mi cita» no da de baja a nadie: tiene que ser el mensaje completo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-3">
          <Switch
            checked={settings.stopKeywordsEnabled}
            onCheckedChange={(v) => setSettings({ ...settings, stopKeywordsEnabled: v })}
            label="Dar de baja con palabras clave"
          />
          <span className="text-sm">Dar de baja con palabras clave</span>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="stop-keywords">Palabras de baja (separadas por comas)</Label>
          <Textarea
            id="stop-keywords"
            rows={2}
            value={keywordsText}
            disabled={!settings.stopKeywordsEnabled}
            onChange={(e) => setKeywordsText(e.target.value)}
          />
          {defaults && (
            <button
              type="button"
              className="text-xs text-brand-ink underline-offset-2 hover:underline"
              onClick={() => setKeywordsText(defaults.stopKeywords.join(", "))}
            >
              Restaurar las palabras por defecto
            </button>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <Switch
              checked={settings.stopReplyEnabled}
              onCheckedChange={(v) => setSettings({ ...settings, stopReplyEnabled: v })}
              label="Responder automáticamente al darse de baja"
            />
            <span className="text-sm">Responder automáticamente al darse de baja</span>
          </div>
          <Textarea
            aria-label="Texto de la respuesta automática"
            rows={2}
            maxLength={500}
            placeholder="Listo, ya no recibirás promociones. Si cambias de opinión, escríbenos."
            value={settings.stopReplyText ?? ""}
            disabled={!settings.stopReplyEnabled}
            onChange={(e) => setSettings({ ...settings, stopReplyText: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Se envía una sola vez, dentro de la ventana de 24 h que abre el mensaje del cliente.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="usage-alert">Avisar cuando el uso del día llegue a (% del límite del número)</Label>
          <Input
            id="usage-alert"
            type="number"
            min={1}
            max={100}
            className="w-28"
            value={settings.usageAlertPercent}
            onChange={(e) => setSettings({ ...settings, usageAlertPercent: Number(e.target.value) })}
          />
        </div>
        {error && <p className="text-sm text-danger-text">{error}</p>}
        {saved && <p className="text-sm text-success-text">Guardado.</p>}
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </Button>
      </CardContent>
    </Card>
  );
}
