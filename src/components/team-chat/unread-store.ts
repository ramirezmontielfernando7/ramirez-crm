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

export function ensureAudio() {
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

type ChimeOptions = { tone?: "suave" | "campana" | "burbuja"; volume?: number };

/**
 * Notas cortas generadas en el navegador (sin archivos ni CDN). Por defecto,
 * las dos notas suaves de siempre; Avisos puede pedir otro tono y volumen.
 * Si la persona aún no tocó la página (el navegador no deja sonar), no suena:
 * el globo basta.
 */
export function playChime(opts: ChimeOptions = {}) {
  ensureAudio();
  if (!audio || audio.state !== "running") return;
  const tone = opts.tone ?? "suave";
  const peak = Math.max(0.0001, 0.08 * (opts.volume ?? 0.6) / 0.6);
  try {
    const now = audio.currentTime;
    const notes =
      tone === "campana"
        ? [{ f: 1046, type: "triangle" as const, at: 0, len: 0.7 }, { f: 1568, type: "triangle" as const, at: 0.12, len: 0.6 }]
        : tone === "burbuja"
          ? [{ f: 520, to: 980, type: "sine" as const, at: 0, len: 0.16 }]
          : [{ f: 880, type: "sine" as const, at: 0, len: 0.2 }, { f: 1320, type: "sine" as const, at: 0.11, len: 0.2 }];
    for (const n of notes) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = n.type;
      const t = now + n.at;
      osc.frequency.setValueAtTime(n.f, t);
      if ("to" in n && n.to) osc.frequency.exponentialRampToValueAtTime(n.to, t + n.len);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + n.len - 0.02);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + n.len);
    }
  } catch {
    // Sin audio disponible: el aviso visual sigue ahí.
  }
}
