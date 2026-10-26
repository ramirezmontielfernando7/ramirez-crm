"use client";

import { useEffect, useSyncExternalStore } from "react";
import { subscribeEvents } from "@/components/use-events";
import { fetchJson } from "@/lib/fetch-json";

/**
 * 039 — No leídos de la Bandeja de clientes, en UN almacén por pestaña (como
 * `team-chat/unread-store.ts`). Lo leen el globo del menú lateral y el
 * las pestañas Empresa · Equipo de la tira de pestañas de la lista y del chat de equipo: una
 * sola consulta para los dos, con un respiro corto ante ráfagas de eventos.
 */

let unread = 0;
let started = false;
let refetchTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(next: number) {
  if (next === unread) return;
  unread = next;
  for (const l of listeners) l();
}

async function refetch() {
  // Solo el total (no la lista entera): mismo filtro que la lista de la Bandeja.
  const res = await fetchJson<{ unread: number }>("/api/conversations/unread");
  // Informativo: un fallo se corrige con el siguiente evento.
  if (res.ok) emit(res.data.unread);
}

function scheduleRefetch() {
  if (refetchTimer) clearTimeout(refetchTimer);
  refetchTimer = setTimeout(() => {
    refetchTimer = null;
    void refetch();
  }, 250);
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  void refetch();
  subscribeEvents({
    current: {
      onMessageNew: () => scheduleRefetch(),
      onConversationUpdated: () => scheduleRefetch(),
      onConnect: () => scheduleRefetch(),
    },
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Total de no leídos de clientes (lo que la persona puede ver). */
export function useInboxUnread(): number {
  useEffect(() => start(), []);
  return useSyncExternalStore(
    subscribe,
    () => unread,
    () => 0
  );
}
