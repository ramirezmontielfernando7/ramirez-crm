"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import type { TeamPersonDto } from "@/lib/team-chat";
import { useViewer } from "@/components/viewer-context";
import { useEvents } from "@/components/use-events";

type Participant = {
  userId: string;
  name: string;
  role: string;
  addedAt: string;
  addedBy: { id: string; name: string } | null;
};

/**
 * 026 — Participantes del chat: asesores que también lo ven y lo atienden,
 * además del asignado (que sigue siendo el dueño del chat). Los agrega y
 * quita quien reparte (`assignment.manage`); los demás solo ven la lista.
 * No reciben el aviso de handoff: ese es del asignado.
 */
export function ParticipantsCard({
  contactId,
  assignedUserId,
  refreshKey = 0,
  onChanged,
}: {
  contactId: string;
  assignedUserId: string | null;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const viewer = useViewer();
  const canManage = viewer.can("assignment.manage");
  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [people, setPeople] = useState<TeamPersonDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetchJson<{ participants: Participant[] }>(`/api/contacts/${contactId}/participants`);
    if (!res.ok) {
      setError(`No se pudieron cargar los participantes: ${res.error}`);
      return;
    }
    setError(null);
    setParticipants(res.data.participants);
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!canManage) return;
    void fetchJson<{ people: TeamPersonDto[] }>("/api/team-chat/people").then((res) => {
      if (res.ok) setPeople(res.data.people);
      else setError(`No se pudo cargar el equipo: ${res.error}`);
    });
  }, [canManage]);

  useEvents({
    onParticipantsChanged: (data) => {
      if (data.contactIds.includes(contactId)) void load();
    },
  });

  async function add(userId: string) {
    if (!userId) return;
    setBusy(true);
    setError(null);
    const res = await fetchJson(`/api/contacts/${contactId}/participants`, jsonInit("POST", { userId }));
    setBusy(false);
    if (!res.ok) {
      setError(`No se agregó: ${res.error}`);
      return;
    }
    await load();
    onChanged?.();
  }

  async function remove(p: Participant) {
    setBusy(true);
    setError(null);
    const res = await fetchJson(
      `/api/contacts/${contactId}/participants?userId=${encodeURIComponent(p.userId)}`,
      { method: "DELETE" }
    );
    setBusy(false);
    if (!res.ok) {
      setError(`No se quitó a ${p.name}: ${res.error}`);
      return;
    }
    await load();
    onChanged?.();
  }

  const taken = new Set([...(participants ?? []).map((p) => p.userId), assignedUserId ?? ""]);
  const candidates = people.filter((p) => !taken.has(p.id));
  // Sin nadie y sin poder agregar, la sección no aporta nada.
  if (!canManage && participants !== null && participants.length === 0 && !error) return null;

  return (
    <section className="border-b p-4">
      <p className="kicker mb-2">Participantes</p>
      {participants === null && !error ? (
        <p className="text-[12px] text-text-3">Cargando…</p>
      ) : (
        <>
          {participants && participants.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {participants.map((p) => (
                <li
                  key={p.userId}
                  className="flex h-6 items-center gap-1 rounded-full border border-border-strong bg-background pl-2.5 pr-1 text-[12px] text-text-2"
                  title={p.addedBy ? `Lo sumó ${p.addedBy.name}` : undefined}
                >
                  {p.userId === viewer.userId ? `${p.name} (tú)` : p.name}
                  {canManage ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(p)}
                      aria-label={`Quitar a ${p.name}`}
                      className="rounded-full p-0.5 text-text-3 hover:bg-secondary hover:text-foreground disabled:opacity-50"
                    >
                      <X className="h-3 w-3" strokeWidth={2} />
                    </button>
                  ) : (
                    <span className="w-1" />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-text-3">Solo lo atiende la persona asignada.</p>
          )}
          {canManage && candidates.length > 0 && (
            <label className="mt-2 flex items-center gap-1.5">
              <UserPlus className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.7} />
              <select
                value=""
                disabled={busy}
                onChange={(e) => void add(e.target.value)}
                aria-label="Agregar participante"
                className="h-8 w-full rounded-md border border-input bg-card px-2 text-[12.5px]"
              >
                <option value="">Agregar participante…</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.role}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="mt-1.5 text-[11px] leading-snug text-text-3">
            Ven y responden este chat; la asignación no cambia y el aviso de atención humana es del asignado.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-[11px] text-danger-text">
          {error}
        </p>
      )}
    </section>
  );
}
