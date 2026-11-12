import { isValidTimeZone } from "@/lib/time/slots";

/**
 * 049 — Mensajes automáticos SIN IA: reglas puras (sin base de datos).
 *
 *  - Bienvenida: el primer mensaje de un chat nuevo, una sola vez.
 *  - Fuera de horario: cuando escriben con el negocio cerrado; como mucho uno
 *    cada 12 h por chat.
 *  - Si caen los dos a la vez (chat nuevo fuera de horario), sale SOLO el de
 *    fuera de horario: no se manda dos veces lo mismo al cliente.
 */

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Lunes",
  tue: "Martes",
  wed: "Miércoles",
  thu: "Jueves",
  fri: "Viernes",
  sat: "Sábado",
  sun: "Domingo",
};

export type DayHours = { open: boolean; from: string; to: string };
export type AutoHours = Record<Weekday, DayHours>;

export const DEFAULT_AUTO_TIMEZONE = "America/Mexico_City";
export const MAX_AUTO_TEXT_LENGTH = 1000;
/** Entre dos «fuera de horario» al mismo chat. */
export const AWAY_COOLDOWN_MS = 12 * 3_600_000;
/** Un chat «olvidado» más viejo que esto ya no se avisa (se vuelve silencio). */
export const FORGOTTEN_MAX_AGE_HOURS = 72;

export const DEFAULT_AUTO_HOURS: AutoHours = {
  mon: { open: true, from: "09:00", to: "18:00" },
  tue: { open: true, from: "09:00", to: "18:00" },
  wed: { open: true, from: "09:00", to: "18:00" },
  thu: { open: true, from: "09:00", to: "18:00" },
  fri: { open: true, from: "09:00", to: "18:00" },
  sat: { open: false, from: "09:00", to: "14:00" },
  sun: { open: false, from: "09:00", to: "14:00" },
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const minutesOf = (hhmm: string): number => {
  const m = HHMM.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** Normaliza lo guardado (o lo recibido): nunca devuelve un horario roto. */
export function parseAutoHours(raw: unknown): AutoHours {
  const out = {} as AutoHours;
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  for (const d of WEEKDAYS) {
    const v = src[d] && typeof src[d] === "object" ? (src[d] as Record<string, unknown>) : {};
    const base = DEFAULT_AUTO_HOURS[d];
    const from = typeof v.from === "string" && HHMM.test(v.from) ? v.from : base.from;
    const to = typeof v.to === "string" && HHMM.test(v.to) ? v.to : base.to;
    out[d] = {
      open: typeof v.open === "boolean" ? v.open : base.open,
      from,
      to,
    };
  }
  return out;
}

/** Un día abierto necesita que cierre DESPUÉS de abrir. */
export function validateAutoHours(hours: AutoHours): string | null {
  for (const d of WEEKDAYS) {
    const h = hours[d];
    if (h.open && minutesOf(h.to) <= minutesOf(h.from)) {
      return `${WEEKDAY_LABEL[d]}: la hora de cierre debe ser después de la de apertura`;
    }
  }
  if (!WEEKDAYS.some((d) => hours[d].open)) {
    return "Deja abierto al menos un día, o apaga el mensaje de fuera de horario";
  }
  return null;
}

/** Día de la semana y minutos desde medianoche en la zona del negocio. */
export function localClock(now: Date, timezone: string): { day: Weekday; minutes: number } {
  const tz = isValidTimeZone(timezone) ? timezone : DEFAULT_AUTO_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"))
  ] ?? "mon";
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function isWithinBusinessHours(now: Date, hours: AutoHours, timezone: string): boolean {
  const { day, minutes } = localClock(now, timezone);
  const h = hours[day];
  if (!h.open) return false;
  return minutes >= minutesOf(h.from) && minutes < minutesOf(h.to);
}

export type AutoReplyKind = "welcome" | "away";

export type AutoReplyInput = {
  now: Date;
  welcome: { enabled: boolean; text: string | null };
  away: { enabled: boolean; text: string | null };
  hours: AutoHours;
  timezone: string;
  /** ¿Es el primer mensaje del cliente en este chat? */
  firstInbound: boolean;
  /** El chat ya tuvo una bienvenida. */
  welcomeSentAt: Date | null;
  awaySentAt: Date | null;
  /** El chat nació de una campaña (el cliente respondió a algo que le mandamos). */
  repliedToCampaign: boolean;
  /** Alguien (persona o IA) ya le escribió a este cliente en este chat. */
  alreadyAnswered: boolean;
};

export function decideAutoReply(i: AutoReplyInput): { kind: AutoReplyKind; text: string } | null {
  const awayText = i.away.text?.trim();
  if (i.away.enabled && awayText && !isWithinBusinessHours(i.now, i.hours, i.timezone)) {
    const recent = i.awaySentAt && i.now.getTime() - i.awaySentAt.getTime() < AWAY_COOLDOWN_MS;
    if (!recent) return { kind: "away", text: awayText };
    // Ya se le avisó que estamos cerrados: tampoco le mandamos la bienvenida encima.
    return null;
  }
  const welcomeText = i.welcome.text?.trim();
  if (
    i.welcome.enabled &&
    welcomeText &&
    i.firstInbound &&
    !i.welcomeSentAt &&
    !i.alreadyAnswered &&
    !i.repliedToCampaign
  ) {
    return { kind: "welcome", text: welcomeText };
  }
  return null;
}

/** `{nombre}` con la primera palabra del nombre del contacto (o nada). */
export function fillAutoText(text: string, contactName: string | null): string {
  const first = (contactName ?? "").trim().split(/\s+/)[0] ?? "";
  const clean = /\p{L}/u.test(first) ? first : "";
  return text
    .replace(/\{nombre\}/gi, clean)
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Horas de espera de un chat sin respuesta, redondeadas a un decimal. */
export function waitingHours(lastInboundAt: Date, now: Date): number {
  return Math.round(((now.getTime() - lastInboundAt.getTime()) / 3_600_000) * 10) / 10;
}

/**
 * ¿Toca avisar de este chat olvidado? Cuando espera ya `thresholdHours`,
 * no es demasiado viejo y no se avisó ya por ESE mensaje del cliente.
 */
export function shouldAlertForgotten(input: {
  now: Date;
  lastInboundAt: Date;
  alertedAt: Date | null;
  thresholdHours: number;
}): boolean {
  const waited = waitingHours(input.lastInboundAt, input.now);
  if (waited < input.thresholdHours) return false;
  if (waited > FORGOTTEN_MAX_AGE_HOURS) return false;
  return !input.alertedAt || input.alertedAt.getTime() < input.lastInboundAt.getTime();
}

export const FORGOTTEN_HOURS_OPTIONS = [1, 2, 4, 8, 24] as const;
