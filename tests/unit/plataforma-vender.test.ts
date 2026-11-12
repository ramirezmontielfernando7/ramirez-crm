import { describe, expect, it } from "vitest";
import { activeAiBonus, billingNoticeText, billingState, extendPaidUntil, monthKey } from "@/lib/billing";
import { healthOf, type HealthInput } from "@/lib/platform-health";
import { activeBroadcastOf } from "@/lib/platform-controls";
import {
  FACTORY_PLAN_PROFILES,
  featureMark,
  mergePlanProfiles,
  nearestPlan,
  planChangeDiff,
  planOfModules,
  planToggles,
} from "@/lib/platform-modules";

/** 048 — Reglas puras de «Plataforma para vender». */

const DAY = 86_400_000;
const now = new Date("2026-11-12T12:00:00Z");
const d = (days: number) => new Date(now.getTime() + days * DAY);

describe("estado del cobro", () => {
  it("sin nada: none, sin restricción", () => {
    expect(billingState(null, now)).toMatchObject({ kind: "none", restricted: false });
    expect(billingState({ trialEndsAt: null, paidUntil: null, graceDays: 5 }, now).kind).toBe("none");
  });
  it("prueba: viva, por terminar (≤3 días) y terminada (restringe)", () => {
    expect(billingState({ trialEndsAt: d(10), paidUntil: null, graceDays: 5 }, now)).toMatchObject({ kind: "trial", daysLeft: 10 });
    expect(billingState({ trialEndsAt: d(3), paidUntil: null, graceDays: 5 }, now).kind).toBe("trial_ending");
    expect(billingState({ trialEndsAt: d(-1), paidUntil: null, graceDays: 5 }, now)).toMatchObject({ kind: "trial_expired", restricted: true });
  });
  it("pago: al corriente, por vencer, en gracia y vencido (restringe)", () => {
    expect(billingState({ trialEndsAt: null, paidUntil: d(20), graceDays: 5 }, now).kind).toBe("paid");
    expect(billingState({ trialEndsAt: null, paidUntil: d(2), graceDays: 5 }, now).kind).toBe("due");
    expect(billingState({ trialEndsAt: null, paidUntil: d(-2), graceDays: 5 }, now)).toMatchObject({ kind: "grace", restricted: false, daysLeft: 3 });
    expect(billingState({ trialEndsAt: null, paidUntil: d(-6), graceDays: 5 }, now)).toMatchObject({ kind: "overdue", restricted: true });
    expect(billingState({ trialEndsAt: null, paidUntil: d(-1), graceDays: 0 }, now).kind).toBe("overdue");
  });
  it("el pago manda sobre la prueba, salvo que la prueba viva dé más tiempo", () => {
    expect(billingState({ trialEndsAt: d(-5), paidUntil: d(20), graceDays: 5 }, now).kind).toBe("paid");
    expect(billingState({ trialEndsAt: d(5), paidUntil: d(-20), graceDays: 5 }, now).kind).toBe("trial");
  });
  it("el aviso al cliente no lleva montos y solo sale cuando hace falta", () => {
    expect(billingNoticeText(billingState({ trialEndsAt: d(10), paidUntil: null, graceDays: 5 }, now))).toBeNull();
    expect(billingNoticeText(billingState({ trialEndsAt: d(1), paidUntil: null, graceDays: 5 }, now))).toBe("Tu prueba gratis termina en 1 día.");
    expect(billingNoticeText(billingState({ trialEndsAt: d(-1), paidUntil: null, graceDays: 5 }, now))).toMatch(/Tus chats siguen llegando/);
    expect(billingNoticeText(billingState({ trialEndsAt: null, paidUntil: d(-6), graceDays: 5 }, now))).toMatch(/pago está pendiente/);
  });
});

describe("pagos", () => {
  it("alarga desde «pagado hasta» si sigue vigente o venció hace poco; si no, desde hoy", () => {
    expect(extendPaidUntil(new Date("2026-12-01T00:00:00Z"), 1, now).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(extendPaidUntil(new Date("2026-11-05T00:00:00Z"), 1, now).toISOString()).toBe("2026-12-05T00:00:00.000Z");
    expect(extendPaidUntil(null, 1, now).toISOString()).toBe("2026-12-12T12:00:00.000Z");
    expect(extendPaidUntil(new Date("2026-01-01T00:00:00Z"), 1, now).toISOString()).toBe("2026-12-12T12:00:00.000Z");
  });
  it("31 de enero + 1 mes = fin de febrero", () => {
    expect(extendPaidUntil(new Date("2027-01-31T00:00:00Z"), 1, new Date("2027-01-20T00:00:00Z")).toISOString()).toBe("2027-02-28T00:00:00.000Z");
  });
  it("la IA extra solo vale en su mes", () => {
    expect(activeAiBonus(2, monthKey(now), now)).toBe(2);
    expect(activeAiBonus(2, "2026-10", now)).toBe(0);
    expect(activeAiBonus(null, null, now)).toBe(0);
  });
});

describe("semáforo de clientes", () => {
  const base: HealthInput = {
    status: "active",
    isPlatform: false,
    createdAt: d(-30),
    whatsappConnected: true,
    agentModule: true,
    agentOn: true,
    lastMessageAt: d(-1),
    lastLoginAt: d(-1),
    sent7d: 100,
    failed7d: 0,
    aiPct: 30,
    billingKind: "paid",
    billingRestricted: false,
  };
  it("todo en orden: verde", () => expect(healthOf(base, now).level).toBe("green"));
  it("sin WhatsApp a los 3 días: rojo", () => expect(healthOf({ ...base, whatsappConnected: false }, now).level).toBe("red"));
  it("recién creada sin WhatsApp: amarillo", () => expect(healthOf({ ...base, createdAt: d(-1), whatsappConnected: false }, now).level).toBe("yellow"));
  it("sin uso 14 días: rojo; 8 días: amarillo", () => {
    expect(healthOf({ ...base, lastMessageAt: d(-15), lastLoginAt: d(-20) }, now).level).toBe("red");
    expect(healthOf({ ...base, lastMessageAt: d(-8), lastLoginAt: d(-9) }, now).level).toBe("yellow");
  });
  it("muchos envíos fallidos: rojo; uno: amarillo", () => {
    expect(healthOf({ ...base, sent7d: 20, failed7d: 6 }, now).level).toBe("red");
    expect(healthOf({ ...base, failed7d: 1 }, now)).toMatchObject({ level: "yellow", reasons: ["1 envío fallido en 7 días"] });
  });
  it("IA al 85 %: amarillo; agotada o pago vencido: rojo", () => {
    expect(healthOf({ ...base, aiPct: 85 }, now).level).toBe("yellow");
    expect(healthOf({ ...base, aiPct: 100 }, now).level).toBe("red");
    expect(healthOf({ ...base, billingKind: "overdue", billingRestricted: true }, now).level).toBe("red");
  });
  it("suspendida: inactiva", () => expect(healthOf({ ...base, status: "suspended" }, now).level).toBe("inactive"));
});

describe("aviso a todos", () => {
  const b = (id: string, extra: Partial<{ startsAt: string; endsAt: string | null; endedAt: string | null; createdAt: string }> = {}) => ({
    id,
    message: id,
    level: "info" as const,
    startsAt: d(-1).toISOString(),
    endsAt: null,
    endedAt: null,
    createdAt: d(-1).toISOString(),
    ...extra,
  });
  it("el más reciente vigente; ni terminados ni vencidos ni futuros", () => {
    expect(activeBroadcastOf([b("viejo"), b("nuevo", { createdAt: now.toISOString() })], now)?.id).toBe("nuevo");
    expect(activeBroadcastOf([b("x", { endedAt: now.toISOString() })], now)).toBeNull();
    expect(activeBroadcastOf([b("x", { endsAt: d(-0.5).toISOString() })], now)).toBeNull();
    expect(activeBroadcastOf([b("x", { startsAt: d(1).toISOString() })], now)).toBeNull();
  });
});

describe("planes y funciones", () => {
  it("los de fábrica: Esencial trae Agente sin Laboratorio", () => {
    expect(FACTORY_PLAN_PROFILES.esencial.agent).toBe(true);
    expect(FACTORY_PLAN_PROFILES.esencial.lab).toBe(false);
    expect(planOfModules(planToggles("pro"))).toBe("pro");
  });
  it("lo guardado se monta encima y nunca deja Laboratorio sin Agente", () => {
    const p = mergePlanProfiles({ esencial: { campaigns: true, agent: false, lab: true, raro: true } });
    expect(p.esencial.campaigns).toBe(true);
    expect(p.esencial.lab).toBe(false);
    expect(p.pro).toEqual(FACTORY_PLAN_PROFILES.pro);
    expect(planOfModules(p.esencial, p)).toBe("esencial");
  });
  it("marcas: incluido, extra, apagado y no incluido", () => {
    expect(featureMark("agent", true, "esencial")).toBe("included");
    expect(featureMark("campaigns", true, "esencial")).toBe("extra");
    expect(featureMark("results", false, "esencial")).toBe("off");
    expect(featureMark("campaigns", false, "esencial")).toBe("not_included");
  });
  it("vista previa: qué se enciende y qué se apaga", () => {
    const diff = planChangeDiff(planToggles("esencial"), planToggles("pro"));
    expect(diff.turnOn).toEqual(expect.arrayContaining(["lab", "agenda"]));
    expect(diff.turnOff).toEqual([]);
    expect(planChangeDiff(planToggles("pro"), planToggles("esencial")).turnOff).toEqual(expect.arrayContaining(["lab"]));
  });
  it("el plan más parecido de un Personalizado", () => {
    expect(nearestPlan({ ...planToggles("pro"), campaigns: true })).toEqual({ plan: "pro", diff: 1 });
  });
});
