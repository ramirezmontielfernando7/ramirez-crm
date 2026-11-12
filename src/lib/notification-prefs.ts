/**
 * Avisos — Preferencias personales de notificación (reglas puras).
 *
 * Cada persona elige qué le avisa, si suena y si sale aviso del sistema. Se
 * guardan en este navegador (`localStorage`): son de quien mira, no de la
 * organización. Pasarlas al servidor pediría una migración.
 */

export const NOTIF_KINDS = ["message", "handoff"] as const;
export type NotifKind = (typeof NOTIF_KINDS)[number];

export const NOTIF_KIND_LABEL: Record<NotifKind, string> = {
  message: "Mensaje nuevo de un cliente",
  handoff: "La IA me pasó un chat",
};

export const TONES = ["suave", "campana", "burbuja"] as const;
export type Tone = (typeof TONES)[number];
export const TONE_LABEL: Record<Tone, string> = { suave: "Suave", campana: "Campana", burbuja: "Burbuja" };

export type ChannelPref = { inApp: boolean; sound: boolean; system: boolean };

export type NotifPrefs = {
  /** Interruptor general del sonido. */
  sound: boolean;
  tone: Tone;
  /** 0 a 1. */
  volume: number;
  rules: Record<NotifKind, ChannelPref>;
  /** «No molestar»: sin sonido ni aviso del sistema entre `from` y `to` (minutos del día). */
  quiet: { on: boolean; from: number; to: number };
};

export const DEFAULT_PREFS: NotifPrefs = {
  sound: true,
  tone: "suave",
  volume: 0.6,
  rules: {
    message: { inApp: true, sound: true, system: true },
    handoff: { inApp: true, sound: true, system: true },
  },
  quiet: { on: false, from: 20 * 60, to: 8 * 60 },
};

export const PREFS_KEY = "dashfort.notif-prefs.v1";

const clamp01 = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
const minutes = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1440 ? n : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Lee lo guardado con tolerancia: lo que falte o venga mal toma el valor de fábrica. */
export function parsePrefs(raw: string | null | undefined): NotifPrefs {
  if (!raw) return DEFAULT_PREFS;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFS;
  }
  if (!data || typeof data !== "object") return DEFAULT_PREFS;
  const d = data as Record<string, unknown>;
  const rules = { ...DEFAULT_PREFS.rules };
  const r = (d.rules ?? {}) as Record<string, Record<string, unknown> | undefined>;
  for (const k of NOTIF_KINDS) {
    const base = DEFAULT_PREFS.rules[k];
    rules[k] = {
      inApp: bool(r[k]?.inApp, base.inApp),
      sound: bool(r[k]?.sound, base.sound),
      system: bool(r[k]?.system, base.system),
    };
  }
  const q = (d.quiet ?? {}) as Record<string, unknown>;
  return {
    sound: bool(d.sound, DEFAULT_PREFS.sound),
    tone: (TONES as readonly string[]).includes(d.tone as string) ? (d.tone as Tone) : DEFAULT_PREFS.tone,
    volume: clamp01(d.volume, DEFAULT_PREFS.volume),
    rules,
    quiet: {
      on: bool(q.on, DEFAULT_PREFS.quiet.on),
      from: minutes(q.from, DEFAULT_PREFS.quiet.from),
      to: minutes(q.to, DEFAULT_PREFS.quiet.to),
    },
  };
}

/** ¿`now` cae dentro del horario de «No molestar»? Cruza la medianoche si from > to. */
export function inQuietHours(quiet: NotifPrefs["quiet"], now: Date): boolean {
  if (!quiet.on || quiet.from === quiet.to) return false;
  const m = now.getHours() * 60 + now.getMinutes();
  return quiet.from < quiet.to ? m >= quiet.from && m < quiet.to : m >= quiet.from || m < quiet.to;
}

type NotifDecision = { inApp: boolean; sound: boolean; system: boolean };

/** Qué hacer con un aviso nuevo según las preferencias y la hora. */
export function decide(kind: NotifKind, prefs: NotifPrefs, now: Date): NotifDecision {
  const rule = prefs.rules[kind];
  const quiet = inQuietHours(prefs.quiet, now);
  return {
    inApp: rule.inApp,
    sound: rule.sound && prefs.sound && !quiet,
    system: rule.system && !quiet,
  };
}

export function minutesLabel(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function parseMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
