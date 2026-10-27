"use client";

import { useEffect, useSyncExternalStore } from "react";
import { subscribeEvents } from "@/components/use-events";
import { fetchJson } from "@/lib/fetch-json";

/**
 * Mi número (046), PR 4 — No leídos de MIS chats, para la pestaña «Mi número»
 * de la Bandeja (como `unread-store.ts`). Solo arranca para quien tiene número;
 * los eventos `number.*` solo le llegan a su dueño.
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
  const res = await fetchJson<{ chats: { unreadCount: number }[] }>("/api/my-number/chats");
  // Informativo: un fallo se corrige con el siguiente evento.
  if (res.ok) emit(res.data.chats.reduce((n, c) => n + c.unreadCount, 0));
}

/** Pide el total otra vez, juntando ráfagas. */
export function refreshNumberUnread() {
  if (!started) return;
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
      onNumberMessage: () => refreshNumberUnread(),
      onNumberConversation: () => refreshNumberUnread(),
      onConnect: () => refreshNumberUnread(),
    },
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Total de no leídos de mi número; 0 (sin pedir nada) si no tengo número. */
export function useNumberUnread(enabled: boolean): number {
  useEffect(() => {
    if (enabled) start();
  }, [enabled]);
  return useSyncExternalStore(
    subscribe,
    () => (enabled ? unread : 0),
    () => 0
  );
}
