/**
 * 048 — Controles de toda la plataforma (reglas puras): interruptores de
 * emergencia y aviso a todos los clientes. Puerta del servidor:
 * `src/server/platform-controls/store.ts`.
 */

export const KILL_SWITCH_KEYS = ["ai", "campaigns", "direct_send"] as const;
export type KillSwitchKey = (typeof KILL_SWITCH_KEYS)[number];

export type KillSwitchState = { key: KillSwitchKey; active: boolean; reason: string | null; updatedAt: string | null };

export const KILL_SWITCH_LABEL: Record<KillSwitchKey, { title: string; effect: string }> = {
  ai: {
    title: "IA de todas las empresas",
    effect: "Ningún agente, creador, varita ni documento llama al modelo. Los chats pasan a una persona; nada se pierde.",
  },
  campaigns: {
    title: "Envío de campañas",
    effect: "Las campañas que estén enviando se pausan y no se puede lanzar ninguna. Los chats normales siguen.",
  },
  direct_send: {
    title: "Envíos por conexión directa",
    effect: "Nada sale por el dispositivo vinculado (empresa ni «Mi número»). Lo que va por Meta sigue igual.",
  },
};

/** Lo que dice la IA cuando el interruptor la apagó (lo ve quien la usa). */
export const AI_KILLED_DETAIL = "La IA está en pausa por mantenimiento de la plataforma. El chat humano sigue disponible.";

export type BroadcastLevel = "info" | "warning";

export type BroadcastDto = {
  id: string;
  message: string;
  level: BroadcastLevel;
  startsAt: string;
  endsAt: string | null;
  endedAt: string | null;
  createdAt: string;
};

/** El aviso vigente de una lista (el más reciente que ya empezó y no terminó). */
export function activeBroadcastOf(list: BroadcastDto[], now: Date = new Date()): BroadcastDto | null {
  const t = now.getTime();
  const vivos = list
    .filter((b) => !b.endedAt && Date.parse(b.startsAt) <= t && (!b.endsAt || Date.parse(b.endsAt) > t))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return vivos[0] ?? null;
}

export const BROADCAST_MAX = 300;
