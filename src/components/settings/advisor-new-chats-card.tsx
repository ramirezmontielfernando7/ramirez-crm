"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { fetchJson } from "@/lib/fetch-json";

/**
 * 048 — «Chats nuevos de los asesores»: con el interruptor encendido, un
 * Asesor solo atiende los chats que ya existen y puede ver. El servidor lo
 * exige en cada ruta que abre un chat; esto solo lo enciende y lo apaga.
 */
export function AdvisorNewChatsCard() {
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetchJson<{ blocked: boolean }>("/api/settings/advisor-new-chats");
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBlocked(res.data.blocked);
    })();
  }, []);

  if (blocked === null) {
    return error ? <p className="text-sm text-danger-text">{error}</p> : null;
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetchJson<{ blocked: boolean }>("/api/settings/advisor-new-chats", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blocked }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
  }

  return (
    <Card className="max-w-3xl" data-testid="advisor-new-chats-card">
      <CardHeader>
        <CardTitle>Chats nuevos de los asesores</CardTitle>
        <CardDescription>
          Controla si los asesores pueden iniciar conversaciones con el número de la empresa. Su número
          personal («Mi número») no se ve afectado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start gap-3">
          <Switch
            checked={blocked}
            onCheckedChange={(v) => {
              setBlocked(v);
              setSaved(false);
            }}
            label="Los asesores solo atienden los chats que tienen asignados"
          />
          <div>
            <p className="text-sm font-medium">Los asesores solo atienden los chats que tienen asignados</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Con esto encendido, un asesor no puede abrir chats nuevos ni escribirle a un contacto nuevo
              desde el número de la empresa (ni con plantilla). Propietario y coordinadores no tienen esta
              restricción. Está apagado por defecto.
            </p>
          </div>
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
