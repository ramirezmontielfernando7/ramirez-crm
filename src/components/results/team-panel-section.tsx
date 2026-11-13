"use client";

import { useEffect, useState } from "react";
import type { TeamPanelDto } from "@/lib/analytics";
import { MAX_TEAM_SLA_MINUTES, MIN_TEAM_SLA_MINUTES } from "@/lib/team-sla";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Section } from "./section";
import { formatSegundos } from "./bot-section";

/**
 * Productividad por asesor: cuántos chats tiene cada quien, cuántos contestó,
 * y cuántos se atrasaron más allá del límite (que el Propietario o un
 * coordinador con ajustes puede cambiar aquí mismo).
 */
export function TeamPanelSection({
  data,
  loading,
  error,
  canEditLimit,
  onLimitSaved,
}: {
  data: TeamPanelDto | null;
  loading: boolean;
  error: string | null;
  canEditLimit: boolean;
  onLimitSaved: () => void;
}) {
  const [minutes, setMinutes] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (data) setMinutes(String(data.limitMinutes));
  }, [data]);

  async function save() {
    setMsg(null);
    const res = await fetchJson<{ minutes: number }>("/api/settings/team-sla", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ minutes: Number(minutes) }),
    });
    if (!res.ok) setMsg(res.error);
    else {
      setMsg("Guardado.");
      onLimitSaved();
    }
  }

  const limite = data?.limitMinutes ?? 5;
  return (
    <Section
      id="equipo"
      title="Productividad por asesor"
      hint={`Un chat se cuenta como tarde si la persona tardó más de ${limite} min en contestar (o aún no contesta).`}
      loading={loading}
      error={error}
      hasData={!!data}
      empty={!!data && data.rows.length === 0}
      emptyText="Todavía no hay chats con mensajes de clientes en este periodo."
      right={
        canEditLimit ? (
          <div className="flex items-center gap-2 text-sm" data-testid="team-sla-editor">
            <label className="text-xs text-text-3" htmlFor="team-sla">
              Límite (min)
            </label>
            <input
              id="team-sla"
              type="number"
              min={MIN_TEAM_SLA_MINUTES}
              max={MAX_TEAM_SLA_MINUTES}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="h-8 w-16 rounded-md border border-input bg-card px-2 text-sm"
            />
            <Button size="sm" variant="outline" onClick={() => void save()}>
              Guardar
            </Button>
            {msg && <span className="text-xs text-text-3">{msg}</span>}
          </div>
        ) : undefined
      }
    >
      {data && (
        <div className="space-y-3" data-testid="team-panel">
          <p className="text-sm">
            Chats esperando a que alguien los tome: <strong data-testid="unassigned-now">{data.unassignedNow}</strong>
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-text-3">
                  <th className="py-1.5 pr-3 font-medium">Persona</th>
                  <th className="px-2 text-right font-medium">Chats</th>
                  <th className="px-2 text-right font-medium">Contestados</th>
                  <th className="px-2 text-right font-medium">Tarde (contestó)</th>
                  <th className="px-2 text-right font-medium">Sin contestar (tarde)</th>
                  <th className="pl-2 text-right font-medium">Tiempo típico</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.userId ?? "sin-asignar"} data-row-advisor={r.name} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{r.name}</td>
                    <td className="px-2 text-right tabular-nums">{r.chats}</td>
                    <td className="px-2 text-right tabular-nums">{r.answered}</td>
                    <td className="px-2 text-right tabular-nums">{r.answeredLate}</td>
                    <td className="px-2 text-right tabular-nums">{r.waitingLate}</td>
                    <td className="pl-2 text-right tabular-nums">{r.medianSeconds === null ? "—" : formatSegundos(r.medianSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  );
}
