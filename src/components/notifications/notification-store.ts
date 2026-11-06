"use client";

import { useEffect, useSyncExternalStore } from "react";
import { subscribeEvents } from "@/components/use-events";
import { ensureAudio, playChime } from "@/components/team-chat/unread-store";
import { fetchJson } from "@/lib/fetch-json";
import { HANDOFF_LABEL } from "@/lib/analytics";
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  decide,
  parsePrefs,
  type NotifKind,
  type NotifPrefs,
} from "@/lib/notification-prefs";
import type { ConversationDto } from "@/lib/types";

/**
 * Avisos — Almacén por pestaña. Junta lo que pasa en vivo (mensaje de un
 * cliente, chat que la IA pasó a una persona), lo muestra en el panel Avisos
 * del menú y, según las preferencias de esta persona, suena y/o manda un
 * aviso del sistema cuando la pestaña no está a la vista.
 *
 * Todo vive en el navegador: la lista se pierde al recargar (la Bandeja ya
 * guarda los no leídos de verdad) y las preferencias van en `localStorage`.
 */

export type NotifItem = {
  id: string;
  kind: NotifKind;
  title: string;
  detail: string;
  href: string;
  at: number;
  read: boolean;
};

type State = { items: NotifItem[]; prefs: NotifPrefs };

const MAX_ITEMS = 30;
let state: State = { items: [], prefs: DEFAULT_PREFS };
let started = false;
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function loadPrefs(): NotifPrefs {
  try {
    return parsePrefs(window.localStorage.getItem(PREFS_KEY));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: NotifPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Sin almacenamiento: vale para esta pestaña.
  }
  set({ prefs });
}

type Who = { id: string | null; name: string };
const whoIs = new Map<string, Who>();

async function contactOf(conversationId: string): Promise<Who> {
  const known = whoIs.get(conversationId);
  if (known) return known;
  const res = await fetchJson<{ conversations: ConversationDto[] }>(
    `/api/conversations?ids=${encodeURIComponent(conversationId)}`
  );
  const c = res.ok ? res.data.conversations?.[0]?.contact : null;
  const out: Who = { id: c?.id ?? null, name: c?.name || "Un cliente" };
  if (c) whoIs.set(conversationId, out);
  return out;
}

function systemNotify(title: string, body: string, href: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  try {
    const n = new Notification(title, { body, tag: href });
    n.onclick = () => {
      window.focus();
      window.location.href = href;
      n.close();
    };
  } catch {
    // Algunos navegadores solo permiten avisos desde un service worker.
  }
}

function push(item: Omit<NotifItem, "id" | "at" | "read">) {
  const now = new Date();
  const d = decide(item.kind, state.prefs, now);
  if (d.sound) playChime({ tone: state.prefs.tone, volume: state.prefs.volume });
  if (d.system) systemNotify(item.title, item.detail, item.href);
  if (!d.inApp) return;
  const entry: NotifItem = { ...item, id: `${item.kind}:${now.getTime()}:${Math.random().toString(36).slice(2, 6)}`, at: now.getTime(), read: false };
  // Un solo aviso sin leer por chat y tipo: el nuevo reemplaza al anterior.
  const rest = state.items.filter((i) => i.read || i.href !== item.href || i.kind !== item.kind);
  set({ items: [entry, ...rest].slice(0, MAX_ITEMS) });
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  state = { ...state, prefs: loadPrefs() };
  const unlock = () => {
    ensureAudio();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  window.addEventListener("storage", (e) => {
    if (e.key === PREFS_KEY) set({ prefs: loadPrefs() });
  });
  subscribeEvents({
    current: {
      onMessageNew: (data) => {
        const msg = data.message as { direction?: string; text?: string | null; type?: string } | null;
        if (msg?.direction !== "in") return;
        const detail = msg.text?.trim() || (msg.type && msg.type !== "text" ? "Te envió un archivo" : "Mensaje nuevo");
        void contactOf(data.conversationId).then((who) =>
          push({
            kind: "message",
            title: who.name,
            detail: detail.length > 120 ? `${detail.slice(0, 117)}…` : detail,
            href: who.id ? `/inbox?contact=${encodeURIComponent(who.id)}` : "/inbox",
          })
        );
      },
      onHandoffRequested: (data) =>
        push({
          kind: "handoff",
          title: `Atención humana: ${data.contactName}`,
          detail: HANDOFF_LABEL[data.reason] ?? "El agente pasó el chat a una persona",
          href: `/inbox?contact=${encodeURIComponent(data.contactId)}`,
        }),
    },
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const SERVER: State = { items: [], prefs: DEFAULT_PREFS };

function useStore(): State {
  useEffect(() => start(), []);
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}

export function useNotifications() {
  const s = useStore();
  return { items: s.items, unread: s.items.filter((i) => !i.read).length, prefs: s.prefs };
}

export function useNotifPrefs(): NotifPrefs {
  return useStore().prefs;
}

export function markAllRead() {
  set({ items: state.items.map((i) => ({ ...i, read: true })) });
}

export function markRead(id: string) {
  set({ items: state.items.map((i) => (i.id === id ? { ...i, read: true } : i)) });
}
