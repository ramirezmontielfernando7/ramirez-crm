"use client";

import { useEffect, useSyncExternalStore } from "react";
import { subscribeEvents } from "@/components/use-events";
import { fetchJson } from "@/lib/fetch-json";

/**
 * 025 — No leídos del chat de equipo, en UN almacén por pestaña.
 *
 * Los globos del menú (en la entrada "Chat de equipo" y sobre el logo con el
 * menú en íconos u oculto) lo leen con `useSyncExternalStore`: cuando cambia
 * el número se repintan SOLO esos globos, nunca el menú entero. El almacén
 * escucha la conexión SSE compartida (`subscribeEvents`) y vuelve a pedir el
 * total con un respiro corto (una ráfaga de mensajes = una consulta).
 *
 * También suena: un mensaje de otra persona, salvo que ese hilo esté abierto
 * y a la vista (ver `setActiveThread`).
 */

type Snapshot = number;

let unread: Snapshot = 0;
let started = false;
let refetchTimer: ReturnType<typeof setTimeout> | null = null;
let activeThreadId: string | null = null;
let myUserId: string | null = null;
const listeners = new Set<() => void>();

function emit(next: number) {
  if (next === unread) return;
  unread = next;
  for (const l of listeners) l();
}

async function refetch() {
  const res = await fetchJson<{ unread: number }>("/api/team-chat/unread");
  // El globo es informativo y se reintenta con el siguiente evento: un fallo
  // aquí no interrumpe a nadie (la pantalla del chat sí muestra sus errores).
  if (res.ok) emit(res.data.unread);
  else console.warn("[chat de equipo] no se pudo actualizar el globo:", res.error);
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
  // El navegador solo deja sonar después de un gesto de la persona: el
  // contexto de audio se crea con su primer clic o tecla.
  const unlock = () => {
    ensureAudio();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
  subscribeEvents({
    current: {
      onTeamMessage: (data) => {
        scheduleRefetch();
        const message = data.message as { author?: { id?: string } | null } | null;
        const fromOther = !!message?.author?.id && message.author.id !== myUserId;
        const watching = activeThreadId === data.threadId && document.visibilityState === "visible";
        if (data.change === "new" && fromOther && !watching) playChime();
      },
      onTeamThread: () => scheduleRefetch(),
      onConnect: () => scheduleRefetch(),
    },
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Total de no leídos (solo hilos donde participa; la supervisión no suma). */
export function useTeamUnread(userId: string): number {
  useEffect(() => {
    myUserId = userId;
    start();
  }, [userId]);
  return useSyncExternalStore(
    subscribe,
    () => unread,
    () => 0
  );
}

/** La pantalla del chat avisa qué hilo tiene abierto (para no sonar ahí). */
export function setActiveThread(threadId: string | null) {
  activeThreadId = threadId;
}

/** Tras leer un hilo, el globo se pone al día sin esperar al evento. */
export function refreshTeamUnread() {
  scheduleRefetch();
}

/* ---------- Sonido ---------- */

let audio: AudioContext | null = null;

function ensureAudio() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    // Sin audio disponible: el aviso visual sigue ahí.
  }
}

/**
 * Dos notas cortas y suaves generadas en el navegador (sin archivos ni CDN).
 * Si la persona aún no tocó la página (el navegador no deja sonar), no suena:
 * el globo basta.
 */
export function playChime() {
  if (!audio || audio.state !== "running") return;
  try {
    const now = audio.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.11;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch {
    // Sin audio disponible: el aviso visual sigue ahí.
  }
}
