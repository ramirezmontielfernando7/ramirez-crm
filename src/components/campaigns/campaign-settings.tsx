"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RATE_CATEGORY_LABEL, type CampaignSettingsDto } from "@/lib/campaigns";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NavRevealButton } from "@/components/nav-mode";

const CATEGORIES = ["marketing", "utility", "authentication"] as const;

/**
 * Campañas v2 — Ajustes de envío de la organización. Las tarifas las captura
 * el negocio (Vocero no trae precios de Meta) y solo sirven para el costo
 * ESTIMADO; el reportado por Meta llega con Métricas.
 */
export function CampaignSettingsForm({ brandName }: { brandName: string }) {
  const [s, setS] = useState<CampaignSettingsDto | null>(null);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetchJson<{ settings: CampaignSettingsDto }>("/api/campaigns/settings");
      if (!res.ok) {
        setError(`No se pudieron cargar los ajustes: ${res.error}`);
        return;
      }
      setS(res.data.settings);
      setRates(Object.fromEntries(CATEGORIES.map((c) => [c, res.data.settings.rates[c]?.toString() ?? ""])));
    })();
  }, []);

  async function save() {
    if (!s) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const parsed: Record<string, number> = {};
    for (const c of CATEGORIES) {
      const raw = (rates[c] ?? "").replace(",", ".").trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setBusy(false);
        setError(`Tarifa de ${RATE_CATEGORY_LABEL[c]} no válida`);
        return;
      }
      parsed[c] = n;
    }
    const res = await fetchJson<{ settings: CampaignSettingsDto }>(
      "/api/campaigns/settings",
      jsonInit("PUT", { ...s, rates: parsed, currency: s.currency?.trim() ? s.currency.trim().toUpperCase() : null })
    );
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setS(res.data.settings);
    setSaved(true);
  }

  const num = (k: keyof CampaignSettingsDto) => (e: React.ChangeEvent<HTMLInputElement>) =>
    s && setS({ ...s, [k]: Number(e.target.value) });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <NavRevealButton />
        <Link href="/campaigns" aria-label="Volver a Campañas">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h2 className="text-[17px] font-bold tracking-tight">Ajustes de envío</h2>
      </header>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-2xl space-y-4" data-testid="campaign-settings">
          {error && (
            <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
              {error}
            </p>
          )}
          {!s ? (
            !error && <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Pausa de seguridad</CardTitle>
                  <CardDescription>
                    {brandName} pausa una campaña sola si algo indica que seguir enviando dañaría tu número. Te avisa en
                    la app con el motivo; la reanudas cuando lo revises.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>Pausar si fallan</span>
                    <Input aria-label="Porcentaje de fallos" type="number" min={1} max={100} className="w-20" value={s.failRatePercent} onChange={num("failRatePercent")} />
                    <span>% de los últimos</span>
                    <Input aria-label="Envíos que se miran" type="number" min={10} max={1000} className="w-24" value={s.failRateWindow} onChange={num("failRateWindow")} />
                    <span>envíos.</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    No cuentan los números sin WhatsApp ni los mensajes que Meta retiene por el límite de marketing
                    por persona (131049): no dicen nada de tu número.
                  </p>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={s.pauseOnQualityRed} onChange={(e) => setS({ ...s, pauseOnQualityRed: e.target.checked })} />
                    Pausar si Meta califica el número con calidad baja (roja)
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>Pausar al llegar al</span>
                    <Input aria-label="Porcentaje del límite" type="number" min={1} max={100} className="w-20" value={s.usagePausePercent} onChange={num("usagePausePercent")} />
                    <span>% del límite de 24 h que reporta Meta (se reintenta sola).</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Tarifas para el costo estimado</CardTitle>
                  <CardDescription>
                    Lo que te cobra Meta por mensaje según la categoría de la plantilla. Consulta tu tarifa vigente en
                    el Administrador de WhatsApp: {brandName} no la adivina. El costo se muestra siempre como{" "}
                    <b>Estimado</b>.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="space-y-1.5">
                    <Label htmlFor="cs-currency">Moneda</Label>
                    <Input
                      id="cs-currency"
                      className="w-24 uppercase"
                      maxLength={3}
                      placeholder="MXN"
                      value={s.currency ?? ""}
                      onChange={(e) => setS({ ...s, currency: e.target.value })}
                    />
                  </div>
                  {CATEGORIES.map((c) => (
                    <div key={c} className="flex items-center gap-2">
                      <Label htmlFor={`rate-${c}`} className="w-32">
                        {RATE_CATEGORY_LABEL[c]}
                      </Label>
                      <Input
                        id={`rate-${c}`}
                        inputMode="decimal"
                        className="w-32"
                        placeholder="Sin capturar"
                        value={rates[c] ?? ""}
                        onChange={(e) => setRates({ ...rates, [c]: e.target.value })}
                      />
                      <span className="text-xs text-muted-foreground">por mensaje</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Respuestas</CardTitle>
                  <CardDescription>Para Métricas: un mensaje del contacto dentro de estas horas cuenta como respuesta.</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center gap-2 text-sm">
                  <Input aria-label="Horas de la ventana de respuesta" type="number" min={1} max={720} className="w-24" value={s.replyWindowHours} onChange={num("replyWindowHours")} />
                  <span>horas</span>
                </CardContent>
              </Card>

              <div className="flex items-center gap-3">
                <Button onClick={() => void save()} disabled={busy}>
                  {busy ? "Guardando…" : "Guardar"}
                </Button>
                {saved && <span className="text-sm text-success-text">Guardado</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
