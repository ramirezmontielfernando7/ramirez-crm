/**
 * Auditoría UX 2026-11 (paquete A) — «Primeros pasos»: los pasos, sus textos
 * y las reglas puras. El servidor dice qué está hecho (`server/onboarding.ts`);
 * aquí no hay BD.
 */

export type OnboardingStepKey = "account" | "whatsapp" | "agent" | "publish" | "ai";

export type OnboardingState = {
  /** Pasos que aplican a esta empresa (sin agente de IA en el plan, solo los dos primeros). */
  steps: { key: OnboardingStepKey; done: boolean }[];
  /** El Propietario cerró la guía («Ocultar guía»). */
  hidden: boolean;
  /** Hay datos de ejemplo cargados. */
  demo: boolean;
  /** Hay un número de WhatsApp conectado (Meta o el dispositivo vinculado). */
  whatsappConnected: boolean;
  /** Plantillas aprobadas por Meta (Marketing: «te faltan 2 cosas»). */
  approvedTemplates: number;
  /** Quien pide puede cambiar la configuración (Propietario). */
  canManage: boolean;
};

export const ONBOARDING_STEP: Record<
  OnboardingStepKey,
  { title: string; body: string; cta: string | null; href: string | null; minutes: number | null }
> = {
  account: { title: "Activa tu cuenta", body: "", cta: null, href: null, minutes: null },
  whatsapp: {
    title: "Conecta tu WhatsApp",
    body: "Escaneas un código con tu WhatsApp Business y listo. Tus chats de los últimos 6 meses llegan solos.",
    cta: "Conectar WhatsApp",
    href: "/settings/whatsapp",
    minutes: 2,
  },
  agent: {
    title: "Cuéntale de tu negocio a tu agente",
    body: "Platica con el creador: qué vendes, horarios y precios. Él arma al agente.",
    cta: "Armar mi agente",
    href: "/lab",
    minutes: 5,
  },
  publish: {
    title: "Pruébalo y publícalo",
    body: "Escríbele como si fueras cliente; nada sale a WhatsApp mientras pruebas. Cuando te guste, pulsa «Publicar».",
    cta: "Probar mi agente",
    href: "/lab",
    minutes: 2,
  },
  ai: {
    title: "Enciende la IA",
    body: "Desde ese momento contesta a tus clientes. La apagas cuando quieras.",
    cta: "Encender la IA",
    href: "/lab",
    minutes: null,
  },
};

/** Orden de los pasos según si el plan trae agente de IA. */
export function onboardingKeys(withAgent: boolean): OnboardingStepKey[] {
  return withAgent ? ["account", "whatsapp", "agent", "publish", "ai"] : ["account", "whatsapp"];
}

/** El paso que toca ahora: el primero sin hacer (`null` = todo listo). */
export function currentStep(state: Pick<OnboardingState, "steps">): OnboardingStepKey | null {
  return state.steps.find((s) => !s.done)?.key ?? null;
}

/** ¿Se enseña la guía? Solo al Propietario, mientras falte algo y no la haya ocultado. */
export function showOnboarding(state: OnboardingState): boolean {
  return state.canManage && !state.hidden && currentStep(state) !== null;
}

export function doneCount(state: Pick<OnboardingState, "steps">): number {
  return state.steps.filter((s) => s.done).length;
}

/** Lo que le falta a la empresa para su primera campaña (vacío = nada). */
export function campaignBlockers(
  state: Pick<OnboardingState, "whatsappConnected" | "approvedTemplates">,
): ("whatsapp" | "template")[] {
  const out: ("whatsapp" | "template")[] = [];
  if (!state.whatsappConnected) out.push("whatsapp");
  if (state.approvedTemplates === 0) out.push("template");
  return out;
}
