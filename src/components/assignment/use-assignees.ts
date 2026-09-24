"use client";

import { useEffect, useState } from "react";
import { useViewer } from "@/components/viewer-context";

export type Assignee = { userId: string; name: string; role: string; assignedCount: number };

/**
 * 020 — El equipo al que se le pueden asignar chats. Solo se pide si quien
 * mira puede repartir: a un asesor la API le respondería 403 y no lo
 * necesita.
 */
export function useAssignees(): Assignee[] {
  const viewer = useViewer();
  const canAssign = viewer.can("assignment.manage");
  const [assignees, setAssignees] = useState<Assignee[]>([]);

  useEffect(() => {
    if (!canAssign) return;
    let alive = true;
    void fetch("/api/settings/team")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { members: Assignee[] } | null) => {
        if (alive && data) setAssignees(data.members);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [canAssign]);

  return assignees;
}

/** POST /api/assignments. Devuelve el mensaje de error, o null si salió bien. */
export async function assignContacts(
  contactIds: string[],
  userId: string | null
): Promise<string | null> {
  const res = await fetch("/api/assignments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactIds, userId }),
  }).catch(() => null);
  if (!res) return "Sin conexión con el servidor";
  if (res.ok) return null;
  const data = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return data?.error?.message ?? "No se pudo asignar";
}
