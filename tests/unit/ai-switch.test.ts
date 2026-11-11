import { describe, expect, it } from "vitest";
import { aiSwitchState, type AiSwitchInput } from "@/lib/ai-switch";

const base: AiSwitchInput = {
  aiEnabled: false,
  orgPaused: false,
  agentReady: true,
  agentName: "Agente principal",
  agentHref: "/lab/agents/ag_1",
  whatsappConnected: true,
  aiConfigured: true,
};

describe("interruptor de la IA (auditoría UX 2026-11, paquete B)", () => {
  it("encendida y sin pausa: contestando", () => {
    expect(aiSwitchState({ ...base, aiEnabled: true }).kind).toBe("on");
  });

  it("encendida con la pausa general: en pausa, y se puede reanudar", () => {
    const v = aiSwitchState({ ...base, aiEnabled: true, orgPaused: true });
    expect(v.kind).toBe("paused");
    expect(v.title).toMatch(/en pausa/);
    expect(v.canTurnOn).toBe(true);
  });

  it("apagada con todo listo: se puede encender", () => {
    const v = aiSwitchState(base);
    expect(v.kind).toBe("off");
    expect(v.missing).toEqual([]);
    expect(v.canTurnOn).toBe(true);
  });

  it("apagada sin WhatsApp: no se puede encender y dice por qué", () => {
    const v = aiSwitchState({ ...base, whatsappConnected: false });
    expect(v.canTurnOn).toBe(false);
    expect(v.missing).toEqual(["whatsapp"]);
    expect(v.hint).toBe("Se activa al conectar WhatsApp");
    expect(v.checklist.find((i) => i.key === "agent")?.label).toBe("Tu agente está listo (Agente principal)");
  });

  it("sin agente publicado: lo primero es publicarlo, con enlace a su editor", () => {
    const v = aiSwitchState({ ...base, agentReady: false, whatsappConnected: false });
    expect(v.missing).toEqual(["agent", "whatsapp"]);
    expect(v.hint).toBe("Se activa al publicar tu agente");
    expect(v.checklist[0]?.href).toBe("/lab/agents/ag_1");
  });

  it("sin servicio de IA en la cuenta: nunca nombra variables de entorno", () => {
    const v = aiSwitchState({ ...base, aiConfigured: false });
    expect(v.missing).toEqual(["service"]);
    expect(JSON.stringify(v)).not.toMatch(/OPENROUTER|token|variable/i);
  });
});
