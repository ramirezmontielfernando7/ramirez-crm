/**
 * Auditoría UX 2026-11 (paquete B) — qué dice el interruptor de la IA del
 * Estudio de IA. Reglas puras: el servidor da los hechos, aquí se decide el
 * texto, lo que falta y si se puede encender.
 */
export type AiSwitchInput = {
  /** `agent_profile.enabled`: el interruptor global. */
  aiEnabled: boolean;
  /** 042: la pausa general (apagar desde aquí la usa). */
  orgPaused: boolean;
  /** El agente general ya se publicó al menos una vez. */
  agentReady: boolean;
  /** Nombre del agente general, para «Tu agente está listo (…)». */
  agentName: string;
  /** Dónde se publica el agente general (su editor). */
  agentHref: string | null;
  whatsappConnected: boolean;
  /** La instancia tiene un modelo de IA configurado. */
  aiConfigured: boolean;
};

type AiSwitchMissing = "agent" | "whatsapp" | "service";

type AiSwitchItem = { key: AiSwitchMissing; done: boolean; label: string; cta: string | null; href: string | null };

type AiSwitchView = {
  kind: "on" | "paused" | "off";
  title: string;
  /** Solo apagada: lo que falta, en orden. */
  missing: AiSwitchMissing[];
  checklist: AiSwitchItem[];
  canTurnOn: boolean;
  /** Bajo el botón deshabilitado: qué lo activa. */
  hint: string | null;
};

export function aiSwitchState(input: AiSwitchInput): AiSwitchView {
  if (input.aiEnabled && !input.orgPaused) return { kind: "on", title: "Tu IA está contestando a tus clientes", missing: [], checklist: [], canTurnOn: false, hint: null };
  if (input.aiEnabled && input.orgPaused) {
    return { kind: "paused", title: "Tu IA está en pausa", missing: [], checklist: [], canTurnOn: true, hint: null };
  }
  const missing: AiSwitchMissing[] = [];
  if (!input.agentReady) missing.push("agent");
  if (!input.whatsappConnected) missing.push("whatsapp");
  if (!input.aiConfigured) missing.push("service");
  const checklist: AiSwitchItem[] = [
    {
      key: "agent",
      done: input.agentReady,
      label: input.agentReady ? `Tu agente está listo (${input.agentName})` : "Publicar tu agente",
      cta: "Ir a tu agente",
      href: input.agentHref,
    },
    {
      key: "whatsapp",
      done: input.whatsappConnected,
      label: "Conectar tu WhatsApp",
      cta: "Conectar ahora",
      href: "/settings/whatsapp",
    },
  ];
  if (!input.aiConfigured) {
    checklist.push({
      key: "service",
      done: false,
      label: "Activar el servicio de IA de tu cuenta (te ayudamos: escríbenos)",
      cta: null,
      href: null,
    });
  }
  const hint =
    missing[0] === "agent"
      ? "Se activa al publicar tu agente"
      : missing[0] === "whatsapp"
        ? "Se activa al conectar WhatsApp"
        : missing[0] === "service"
          ? "Se activa cuando el servicio de IA esté listo"
          : null;
  return { kind: "off", title: "Tu IA está apagada", missing, checklist, canTurnOn: missing.length === 0, hint };
}
