"use client";

import { useCallback, useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { formatTime } from "@/components/inbox/helpers";
import { assignContacts, useAssignees } from "@/components/assignment/use-assignees";
import { useViewer } from "@/components/viewer-context";
import { Collapse, DisclosureButton, useDisclosureId } from "@/components/motion";

type HistoryItem = {
  id: string;
  fromUser: { id: string; name: string } | null;
  toUser: { id: string; name: string } | null;
  actor: { id: string; name: string } | null;
  source: string;
  reason: string | null;
  occurredAt: string;
};

/**
 * 020 — Quién atiende a este contacto, el selector para reasignarlo (solo
 * quien reparte) y el historial: quién lo tuvo, desde cuándo y quién lo
 * movió. Mismo lenguaje visual que el resto del panel de detalles.
 *
 * 022 — El historial queda plegado tras "Ver historial de asignación" y solo
 * para quien reparte (Propietario/Coordinador). Es orden, no secreto: los
 * mismos cambios salen en la línea de tiempo del chat, que el Asesor sí ve.
 */
export function AssignmentCard({
  contactId,
  refreshKey = 0,
  onChanged,
}: {
  contactId: string;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const viewer = useViewer();
  const canAssign = viewer.can("assignment.manage");
  const assignees = useAssignees();
  const [assignedUserId, setAssignedUserId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyId = useDisclosureId("assignment-history");

  const load = useCallback(async () => {
    const data = await fetch(`/api/contacts/${contactId}/assignments`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!data) return;
    setAssignedUserId(data.assignedUserId ?? null);
    setHistory(data.history ?? []);
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function change(value: string) {
    const userId = value === "" ? null : value;
    setSaving(true);
    setError(null);
    const err = await assignContacts([contactId], userId);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    await load();
    onChanged?.();
  }

  const last = history.at(-1)?.toUser;
  const currentName =
    assignedUserId === null
      ? null
      : assignedUserId === viewer.userId
        ? "ti"
        : last?.id === assignedUserId
          ? last.name
          : (assignees.find((a) => a.userId === assignedUserId)?.name ??
            "alguien del equipo");

  return (
    <section className="border-b p-4">
      <p className="kicker mb-2">Asignación</p>
      {canAssign ? (
        <select
          value={assignedUserId ?? ""}
          disabled={saving}
          onChange={(e) => void change(e.target.value)}
          aria-label="Asignar a"
          className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
        >
          <option value="">Sin asignar</option>
          {assignees.map((a) => (
            <option key={a.userId} value={a.userId}>
              {a.userId === viewer.userId ? `${a.name} (tú)` : a.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="flex items-center gap-1.5 text-[13px] text-text-2">
          <UserRound className="h-4 w-4 text-text-3" strokeWidth={1.7} />
          {currentName ? `Asignado a ${currentName}` : "Sin asignar"}
        </p>
      )}
      {error && <p className="mt-1.5 text-[11px] text-danger-text">{error}</p>}

      {canAssign && history.length > 0 && (
        <div className="mt-2.5">
          <DisclosureButton
            open={historyOpen}
            onToggle={() => setHistoryOpen((v) => !v)}
            controls={historyId}
            className="text-[12px] font-medium text-text-2 hover:text-foreground"
          >
            {historyOpen ? "Ocultar historial de asignación" : "Ver historial de asignación"}
          </DisclosureButton>
          <Collapse open={historyOpen} id={historyId}>
            <ol className="space-y-1.5 pt-2">
              {[...history].reverse().slice(0, 6).map((h) => (
                <li key={h.id} className="text-[11px] leading-relaxed text-text-3">
                  <span className="font-mono">{formatTime(h.occurredAt)}</span>{" "}
                  {describe(h)}
                </li>
              ))}
            </ol>
          </Collapse>
        </div>
      )}
    </section>
  );
}

function describe(h: HistoryItem): string {
  const to = h.toUser?.name ?? "sin asignar";
  const from = h.fromUser?.name;
  const by = h.actor ? ` · por ${h.actor.name}` : h.source === "auto" ? " · reparto automático" : "";
  const lote = h.source === "lote" ? " (en lote)" : "";
  const why = h.reason ? ` — ${h.reason}` : "";
  return from ? `De ${from} a ${to}${lote}${by}${why}` : `Asignado a ${to}${lote}${by}${why}`;
}
