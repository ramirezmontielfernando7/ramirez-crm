"use client";

import { useCallback, useEffect, useState } from "react";
import { Megaphone, OctagonAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BROADCAST_MAX, KILL_SWITCH_LABEL, type BroadcastDto, type KillSwitchState } from "@/lib/platform-controls";
import { cn } from "@/lib/utils";
import { api, fecha } from "./api";

/**
 * 048 — Plataforma → Controles: los interruptores de emergencia por función
 * para TODAS las empresas a la vez y el aviso a todos los clientes. Cada
 * cambio pide confirmación y queda en la bitácora.
 */

type Data = { switches: KillSwitchState[]; broadcasts: BroadcastDto[] };

const vigente = (b: BroadcastDto) => !b.endedAt && (!b.endsAt || Date.parse(b.endsAt) > Date.now());

export function ControlsClient() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [level, setLevel] = useState<"info" | "warning">("info");
  const [hours, setHours] = useState("");

  const load = useCallback(async () => {
    const r = await api<Data>("/api/platform/controls");
    if (r.data) setData(r.data);
    else setError(r.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function put(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const r = await api<Data>("/api/platform/controls", { method: "PUT", body: JSON.stringify(body) });
    setBusy(false);
    if (r.data) setData(r.data);
    else setError(r.error);
    return !!r.data;
  }

  const current = data?.broadcasts.find(vigente) ?? null;
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border bg-card p-4" data-testid="platform-kill-switches">
        <div className="flex items-start gap-2">
          <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger-text" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold">Interruptores de emergencia</h2>
            <p className="text-xs text-text-3">
              Apagan una función para TODAS las empresas a la vez (por ejemplo, si Meta o el proveedor de IA tienen un problema). Los chats nunca se pierden. Tarda hasta 10 segundos en llegar a todos.
            </p>
          </div>
        </div>
        {data === null ? (
          <p className="text-sm text-text-2">{error ?? "Cargando…"}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {data.switches.map((s) => (
              <li key={s.key} className={cn("flex items-start gap-3 px-3 py-3", s.active && "bg-danger-tint")} data-testid={`platform-kill-${s.key}`} data-active={s.active}>
                <Switch
                  size="sm"
                  checked={s.active}
                  disabled={busy}
                  label={`Apagar ${KILL_SWITCH_LABEL[s.key].title}`}
                  onCheckedChange={(next) => {
                    const pregunta = next
                      ? `¿Apagar «${KILL_SWITCH_LABEL[s.key].title}» para TODAS las empresas? ${KILL_SWITCH_LABEL[s.key].effect}`
                      : `¿Volver a encender «${KILL_SWITCH_LABEL[s.key].title}» para todas las empresas?`;
                    if (!window.confirm(pregunta)) return;
                    const reason = next ? (window.prompt("Motivo (queda en la bitácora):") ?? "") : null;
                    void put({ killSwitch: { key: s.key, active: next, reason } });
                  }}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {KILL_SWITCH_LABEL[s.key].title}
                    <span className={cn("ml-2 text-xs font-medium", s.active ? "text-danger-text" : "text-success-text")}>
                      {s.active ? "APAGADA" : "Funcionando"}
                    </span>
                  </p>
                  <p className="text-xs text-text-3">{KILL_SWITCH_LABEL[s.key].effect}</p>
                  {s.active && s.reason && <p className="text-xs text-text-2">Motivo: {s.reason}</p>}
                  {s.updatedAt && <p className="text-[11px] text-text-3">Último cambio: {fecha(s.updatedAt)}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-4" data-testid="platform-broadcast">
        <div className="flex items-start gap-2">
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-brand-text" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold">Aviso a todos los clientes</h2>
            <p className="text-xs text-text-3">Una franja arriba de la pantalla para todas las personas de todas las empresas (mantenimiento o novedades). Cada quien la puede cerrar.</p>
          </div>
        </div>
        {current && (
          <div
            className={cn("flex flex-wrap items-start gap-2 rounded-md border px-3 py-2 text-sm", current.level === "warning" ? "border-warning-soft bg-warning-tint text-warning-text" : "border-info-soft bg-info-tint text-info-text")}
            data-testid="platform-broadcast-current"
          >
            <p className="min-w-0 flex-1 break-words">
              <span className="font-medium">Publicado ahora: </span>
              {current.message}
              {current.endsAt && <span className="text-xs"> · se quita solo el {fecha(current.endsAt)}</span>}
            </p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void put({ endBroadcast: true })} data-testid="platform-broadcast-end">
              Quitar aviso
            </Button>
          </div>
        )}
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const h = hours ? Number(hours) : null;
            if (h !== null && (!Number.isInteger(h) || h < 1 || h > 720)) return setError("Las horas van de 1 a 720 (o vacío para quitarlo a mano).");
            if (!window.confirm(current ? "¿Publicar este aviso? Reemplaza al que está publicado." : "¿Publicar este aviso para todos los clientes?")) return;
            void put({ broadcast: { message, level, endsAt: h ? new Date(Date.now() + h * 3_600_000).toISOString() : null } }).then((ok) => ok && setMessage(""));
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="broadcast-message" className="text-xs text-text-2">
              Mensaje ({message.length}/{BROADCAST_MAX})
            </Label>
            <Input
              id="broadcast-message"
              maxLength={BROADCAST_MAX}
              placeholder="Ej.: El domingo de 2 a 3 a. m. haremos mantenimiento; los mensajes llegan al terminar."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={busy}
              data-testid="platform-broadcast-message"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="broadcast-level" className="text-xs text-text-2">
                Tipo
              </Label>
              <select
                id="broadcast-level"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={level}
                onChange={(e) => setLevel(e.target.value as "info" | "warning")}
                disabled={busy}
              >
                <option value="info">Novedad (azul)</option>
                <option value="warning">Mantenimiento o aviso importante (amarillo)</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="broadcast-hours" className="text-xs text-text-2">
                Se quita solo en (horas, opcional)
              </Label>
              <Input id="broadcast-hours" className="w-28" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} disabled={busy} />
            </div>
            <Button size="sm" type="submit" disabled={busy || message.trim().length === 0} data-testid="platform-broadcast-publish">
              Publicar aviso
            </Button>
          </div>
        </form>
        {data && data.broadcasts.length > 0 && (
          <details className="text-xs text-text-2">
            <summary className="cursor-pointer">Avisos anteriores</summary>
            <ul className="mt-2 space-y-1">
              {data.broadcasts.map((b) => (
                <li key={b.id}>
                  {fecha(b.createdAt)} · {b.message}
                  {vigente(b) ? " (publicado)" : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
