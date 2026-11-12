import { describe, expect, it } from "vitest";
import {
  AWAY_COOLDOWN_MS,
  DEFAULT_AUTO_HOURS,
  decideAutoReply,
  fillAutoText,
  isWithinBusinessHours,
  localClock,
  parseAutoHours,
  shouldAlertForgotten,
  validateAutoHours,
  waitingHours,
  type AutoReplyInput,
} from "@/lib/auto-replies";
import { senderLabel } from "@/server/data-export/stream";
import { exportLock } from "@/server/data-export/guard";

const TZ = "America/Mexico_City"; // UTC-6 todo el año desde 2022
// Martes 2026-11-10 a las 10:00 y a las 22:00 hora de CDMX.
const open = new Date("2026-11-10T16:00:00Z");
const closed = new Date("2026-11-11T04:00:00Z");
// Domingo 2026-11-15 a las 12:00 CDMX.
const sunday = new Date("2026-11-15T18:00:00Z");

const base: AutoReplyInput = {
  now: closed,
  welcome: { enabled: true, text: "Hola {nombre}" },
  away: { enabled: true, text: "Estamos cerrados" },
  hours: DEFAULT_AUTO_HOURS,
  timezone: TZ,
  firstInbound: true,
  welcomeSentAt: null,
  awaySentAt: null,
  repliedToCampaign: false,
  alreadyAnswered: false,
};

describe("049 horario del negocio", () => {
  it("lee el día y la hora en la zona del negocio, no en UTC", () => {
    expect(localClock(open, TZ)).toEqual({ day: "tue", minutes: 600 });
    expect(localClock(closed, TZ)).toEqual({ day: "tue", minutes: 22 * 60 });
  });
  it("abierto entre apertura (incluida) y cierre (excluido)", () => {
    expect(isWithinBusinessHours(open, DEFAULT_AUTO_HOURS, TZ)).toBe(true);
    expect(isWithinBusinessHours(new Date("2026-11-10T15:00:00Z"), DEFAULT_AUTO_HOURS, TZ)).toBe(true); // 09:00
    expect(isWithinBusinessHours(new Date("2026-11-11T00:00:00Z"), DEFAULT_AUTO_HOURS, TZ)).toBe(false); // 18:00
    expect(isWithinBusinessHours(closed, DEFAULT_AUTO_HOURS, TZ)).toBe(false);
  });
  it("un día cerrado es cerrado todo el día", () => {
    expect(isWithinBusinessHours(sunday, DEFAULT_AUTO_HOURS, TZ)).toBe(false);
  });
  it("una zona inventada cae a la de fábrica en vez de tronar", () => {
    expect(() => isWithinBusinessHours(open, DEFAULT_AUTO_HOURS, "Marte/Olimpo")).not.toThrow();
  });
  it("parseAutoHours repara lo roto y valida que cierre después de abrir", () => {
    const h = parseAutoHours({ mon: { open: true, from: "25:00", to: "x" }, tue: "no" });
    expect(h.mon).toEqual({ open: true, from: "09:00", to: "18:00" });
    expect(h.sun.open).toBe(false);
    expect(validateAutoHours({ ...DEFAULT_AUTO_HOURS, wed: { open: true, from: "18:00", to: "09:00" } })).toMatch(/Miércoles/);
    expect(validateAutoHours(parseAutoHours(null))).toBeNull();
    const allClosed = parseAutoHours(Object.fromEntries(Object.keys(DEFAULT_AUTO_HOURS).map((d) => [d, { open: false, from: "09:00", to: "10:00" }])));
    expect(validateAutoHours(allClosed)).toMatch(/al menos un día/);
  });
});

describe("049 qué mensaje automático sale", () => {
  it("fuera de horario sale el aviso, aunque sea chat nuevo (no los dos)", () => {
    expect(decideAutoReply(base)).toEqual({ kind: "away", text: "Estamos cerrados" });
  });
  it("dentro del horario, un chat nuevo recibe la bienvenida", () => {
    expect(decideAutoReply({ ...base, now: open })).toEqual({ kind: "welcome", text: "Hola {nombre}" });
  });
  it("la bienvenida sale una sola vez, solo al primer mensaje y solo si nadie contestó", () => {
    expect(decideAutoReply({ ...base, now: open, firstInbound: false })).toBeNull();
    expect(decideAutoReply({ ...base, now: open, welcomeSentAt: open })).toBeNull();
    expect(decideAutoReply({ ...base, now: open, alreadyAnswered: true })).toBeNull();
    expect(decideAutoReply({ ...base, now: open, repliedToCampaign: true })).toBeNull();
  });
  it("el aviso de fuera de horario no se repite en 12 h, pero sí después", () => {
    const hace = (ms: number) => new Date(closed.getTime() - ms);
    expect(decideAutoReply({ ...base, firstInbound: false, awaySentAt: hace(AWAY_COOLDOWN_MS - 60_000) })).toBeNull();
    expect(decideAutoReply({ ...base, firstInbound: false, awaySentAt: hace(AWAY_COOLDOWN_MS + 60_000) })?.kind).toBe("away");
  });
  it("cerrado y ya avisado: tampoco manda la bienvenida encima", () => {
    expect(decideAutoReply({ ...base, awaySentAt: new Date(closed.getTime() - 60_000) })).toBeNull();
  });
  it("apagado o sin texto no manda nada", () => {
    expect(decideAutoReply({ ...base, now: open, welcome: { enabled: false, text: "x" } })).toBeNull();
    expect(decideAutoReply({ ...base, now: open, welcome: { enabled: true, text: "  " } })).toBeNull();
    expect(decideAutoReply({ ...base, away: { enabled: false, text: "x" }, welcome: { enabled: false, text: null } })).toBeNull();
  });
  it("{nombre} se llena con la primera palabra y se limpia si no hay nombre", () => {
    expect(fillAutoText("Hola {nombre}, bienvenido", "María López")).toBe("Hola María, bienvenido");
    expect(fillAutoText("Hola {nombre}, bienvenido", null)).toBe("Hola, bienvenido");
    expect(fillAutoText("Hola {nombre}!", "+52 55 1234")).toBe("Hola!");
    expect(fillAutoText("Hola {nombre}!", "—")).toBe("Hola!");
  });
});

describe("049 chats olvidados", () => {
  const now = new Date("2026-11-10T20:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  it("avisa al llegar al umbral, una vez por mensaje del cliente", () => {
    expect(shouldAlertForgotten({ now, lastInboundAt: hoursAgo(1.5), alertedAt: null, thresholdHours: 2 })).toBe(false);
    expect(shouldAlertForgotten({ now, lastInboundAt: hoursAgo(2), alertedAt: null, thresholdHours: 2 })).toBe(true);
    expect(shouldAlertForgotten({ now, lastInboundAt: hoursAgo(3), alertedAt: hoursAgo(1), thresholdHours: 2 })).toBe(false);
    // El cliente volvió a escribir después del último aviso: toca avisar otra vez.
    expect(shouldAlertForgotten({ now, lastInboundAt: hoursAgo(3), alertedAt: hoursAgo(5), thresholdHours: 2 })).toBe(true);
  });
  it("no avisa de chats de hace más de 3 días", () => {
    expect(shouldAlertForgotten({ now, lastInboundAt: hoursAgo(73), alertedAt: null, thresholdHours: 2 })).toBe(false);
  });
  it("waitingHours redondea a un decimal", () => {
    expect(waitingHours(hoursAgo(2.04), now)).toBe(2);
  });
});

describe("049 exportar datos", () => {
  it("dice quién escribió cada mensaje", () => {
    const m = { direction: "out", origin: "operator", aiGenerated: false, autoKind: null as string | null };
    expect(senderLabel({ ...m, direction: "in" })).toBe("cliente");
    expect(senderLabel(m)).toBe("equipo");
    expect(senderLabel({ ...m, autoKind: "away" })).toBe("automático");
    expect(senderLabel({ ...m, origin: "ai", aiGenerated: true })).toBe("IA");
    expect(senderLabel({ ...m, origin: "template" })).toBe("plantilla");
    expect(senderLabel({ ...m, origin: "manual" })).toBe("teléfono del negocio");
  });
  it("solo una exportación a la vez por organización", () => {
    const a = exportLock.acquire("org_x", 1000);
    expect(a).not.toBeNull();
    expect(exportLock.acquire("org_x", 2000)).toBeNull();
    expect(exportLock.acquire("org_y", 2000)).not.toBeNull();
    a!();
    const b = exportLock.acquire("org_x", 3000);
    expect(b).not.toBeNull();
    b!();
    // Un candado viejo (flujo caído) vence solo.
    exportLock.acquire("org_z", 0);
    expect(exportLock.acquire("org_z", 16 * 60_000)).not.toBeNull();
  });
});
