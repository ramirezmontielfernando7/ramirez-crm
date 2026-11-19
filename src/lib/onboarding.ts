/**
 * Auditoría UX 2026-11 (paquete A) — «Primeros pasos»: los pasos, sus textos
 * y las reglas puras. El servidor dice qué está hecho (`server/onboarding.ts`);
 * aquí no hay BD.
 */

export type OnboardingStepKey = "account" | "whatsapp" | "agent" | "publish" | "ai";

/**
 * Onboarding guiado (2026-11) — lo opcional para sacarle más jugo: no cuenta
 * en el avance ni detiene la guía, pero se palomea solo cuando se hace.
 */
export type OnboardingExtraKey = "team" | "pipeline" | "contacts" | "aiConnector";

export type OnboardingState = {
  /** Pasos que aplican a esta empresa (sin agente de IA en el plan, solo los dos primeros). */
  steps: { key: OnboardingStepKey; done: boolean }[];
  /** Lo opcional que aplica a esta empresa (el conector de IA solo con su complemento). */
  extras: { key: OnboardingExtraKey; done: boolean; href?: string }[];
  /** La empresa tiene el complemento «Conector de IA» (ChatGPT, Claude…). */
  conectorIa: boolean;
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
    body: "Si ya usas WhatsApp Business en tu celular, escaneas un código y listo: tus chats de los últimos 6 meses llegan solos. Si es un número nuevo, Meta le manda un código por SMS o llamada a ese número.",
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

export const ONBOARDING_EXTRA: Record<
  OnboardingExtraKey,
  { title: string; body: string; cta: string; href: string }
> = {
  team: {
    title: "Invita a tu equipo",
    body: "Cada asesor entra con su propio acceso y ve solo lo que le toca.",
    cta: "Invitar",
    href: "/settings/team",
  },
  pipeline: {
    title: "Pon tus etapas y etiquetas",
    body: "Que el embudo diga cómo vendes tú: «Cotizó», «Visitó», «Pagó»…",
    cta: "Ajustar",
    href: "/pipeline",
  },
  contacts: {
    title: "Sube tus contactos",
    body: "Tu lista de clientes desde Excel o CSV.",
    cta: "Importar",
    href: "/contacts",
  },
  aiConnector: {
    title: "Conecta ChatGPT o Claude",
    body: "Pregúntale a tu IA de siempre por tus chats y ventas, sin abrir el CRM.",
    cta: "Conectar",
    href: "/settings/mi-ia",
  },
};

/** Lo opcional, en orden; el conector de IA solo si la empresa tiene el complemento. */
export function onboardingExtraKeys(conectorIa: boolean): OnboardingExtraKey[] {
  return conectorIa ? ["team", "pipeline", "contacts", "aiConnector"] : ["team", "pipeline", "contacts"];
}

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
