import { describe, expect, it } from "vitest";
import {
  campaignBlockers,
  currentStep,
  doneCount,
  onboardingExtraKeys,
  onboardingKeys,
  showOnboarding,
  type OnboardingState,
} from "@/lib/onboarding";
import { isDemoPhone } from "@/lib/demo";

const base = (over: Partial<OnboardingState> = {}): OnboardingState => ({
  steps: onboardingKeys(true).map((key) => ({ key, done: key === "account" })),
  extras: onboardingExtraKeys(false).map((key) => ({ key, done: false })),
  conectorIa: false,
  hidden: false,
  demo: false,
  whatsappConnected: false,
  approvedTemplates: 0,
  canManage: true,
  ...over,
});

describe("primeros pasos (auditoría UX 2026-11, paquete A)", () => {
  it("con agente son 5 pasos; sin agente, solo cuenta y WhatsApp", () => {
    expect(onboardingKeys(true)).toEqual(["account", "whatsapp", "agent", "publish", "ai"]);
    expect(onboardingKeys(false)).toEqual(["account", "whatsapp"]);
  });

  it("lo opcional no cuenta en el avance; el conector de IA solo con su complemento", () => {
    expect(onboardingExtraKeys(false)).toEqual(["team", "pipeline", "contacts"]);
    expect(onboardingExtraKeys(true)).toEqual(["team", "pipeline", "contacts", "aiConnector"]);
    const conTodo = base({ extras: onboardingExtraKeys(true).map((key) => ({ key, done: true })) });
    expect(doneCount(conTodo)).toBe(1);
    expect(showOnboarding(conTodo)).toBe(true);
  });

  it("el paso que toca es el primero sin hacer", () => {
    expect(currentStep(base())).toBe("whatsapp");
    const s = base({ steps: base().steps.map((x) => ({ ...x, done: x.key !== "ai" })) });
    expect(currentStep(s)).toBe("ai");
    expect(doneCount(s)).toBe(4);
  });

  it("solo se enseña al Propietario, sin ocultar y con algo pendiente", () => {
    expect(showOnboarding(base())).toBe(true);
    expect(showOnboarding(base({ canManage: false }))).toBe(false);
    expect(showOnboarding(base({ hidden: true }))).toBe(false);
    const listo = base({ steps: base().steps.map((x) => ({ ...x, done: true })) });
    expect(showOnboarding(listo)).toBe(false);
  });

  it("antes de la primera campaña: WhatsApp y plantilla aprobada", () => {
    expect(campaignBlockers({ whatsappConnected: false, approvedTemplates: 0 })).toEqual(["whatsapp", "template"]);
    expect(campaignBlockers({ whatsappConnected: true, approvedTemplates: 0 })).toEqual(["template"]);
    expect(campaignBlockers({ whatsappConnected: true, approvedTemplates: 2 })).toEqual([]);
  });

  it("reconoce los teléfonos de ejemplo con o sin el 1 de celular", () => {
    expect(isDemoPhone("5215612340001")).toBe(true);
    expect(isDemoPhone("+52 56 1234 0008")).toBe(true);
    expect(isDemoPhone("5215612340009")).toBe(false);
    expect(isDemoPhone(null)).toBe(false);
    expect(isDemoPhone("0001")).toBe(false);
  });
});
