import { beforeEach, describe, expect, it, vi } from "vitest";

const chat = vi.fn();
vi.mock("@/server/ai-quota/llm", () => ({ chatJsonForOrg: (...a: unknown[]) => chat(...a) }));

import { clientsOf, computeScore, generateClients, genericClients, nextClientMessage, reviewConversation, type SimClient } from "@/server/lab/simulated";
import type { RunSnapshot } from "@/server/agents/snapshot";

/**
 * 0070 — Clientes simulados (reemplazan a las personas fijas y al juez):
 * se inventan con lo que sabe el agente, siguen la plática y una revisión
 * dice Bien / Revisar / Falló. Si la IA falla, entran clientes genéricos.
 */

const snapshot = {
  source: "draft",
  agentId: "agt_1",
  internalName: "General",
  isGeneral: true,
  config: { v: 1, displayName: null, tone: null, greeting: null, instructions: "Atiende inscripciones", escalationRules: null, useSharedKb: true, docSources: { mode: "all" } },
  kb: [],
  kbText: "P: ¿Colegiatura? R: 3,000 al mes",
  docSourceNames: ["Becas 2027"],
} as unknown as RunSnapshot;

const client: SimClient = { key: "sim_1", label: "Mamá de un aspirante", summary: "Costos", goal: "Saber costos", style: "Formal", firstMessage: "Hola" };

describe("clientes simulados", () => {
  beforeEach(() => chat.mockReset());

  it("inventa los clientes con lo que sabe el agente, anotados al agente y con el modelo del creador", async () => {
    chat.mockResolvedValue({
      ok: true,
      data: { clientes: [{ nombre: "Aspirante a Psicología", resumen: "Becas", objetivo: "Beca", estilo: "Joven", primer_mensaje: "¿Hay becas?" }, { nombre: "" }] },
    });
    const list = await generateClients("org_1", snapshot, 3);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ key: "sim_1", label: "Aspirante a Psicología", firstMessage: "¿Hay becas?" });
    // El inválido se descarta y se completa con genéricos.
    expect(list.map((c) => c.key)).toEqual(["sim_1", "sim_2", "sim_3"]);
    const [org, kind, , messages, opts] = chat.mock.calls[0]!;
    expect(org).toBe("org_1");
    expect(kind).toBe("lab");
    expect(opts).toMatchObject({ use: "creator", agentId: "agt_1" });
    const user = (messages as { content: string }[])[1]!.content;
    expect(user).toContain("Colegiatura");
    expect(user).toContain("Becas 2027");
  });

  it("si la IA no responde, usa clientes genéricos (nunca de una ferretería)", async () => {
    chat.mockResolvedValue({ ok: false, error: "provider_error", detail: "x" });
    const list = await generateClients("org_1", snapshot, 5);
    expect(list).toEqual(genericClients(5));
    expect(JSON.stringify(list)).not.toMatch(/taladro|martillo|pintura/i);
  });

  it("el cliente sigue la plática o termina", async () => {
    chat.mockResolvedValueOnce({ ok: true, data: { mensaje: "¿Y las becas?", terminado: false } });
    expect(await nextClientMessage("org_1", "agt_1", client, [{ role: "cliente", text: "Hola" }])).toBe("¿Y las becas?");
    chat.mockResolvedValueOnce({ ok: true, data: { mensaje: "gracias", terminado: true } });
    expect(await nextClientMessage("org_1", "agt_1", client, [])).toBeNull();
    chat.mockResolvedValueOnce({ ok: false, error: "provider_error", detail: "x" });
    expect(await nextClientMessage("org_1", "agt_1", client, [])).toBeNull();
  });

  it("la revisión: Bien / Revisar / Falló → verde / amarillo / rojo, con notas y arreglo", async () => {
    chat.mockResolvedValueOnce({ ok: true, data: { resultado: "revisar", notas: ["Dio un precio inventado."], arreglo: "No inventes precios." } });
    const r = await reviewConversation({ organizationId: "org_1", snapshot, client, transcript: [], handedOff: false });
    expect(r).toEqual({ status: "done", veredicto: "amarillo", review: { notas: ["Dio un precio inventado."], arreglo: "No inventes precios." } });
    expect(chat.mock.calls[0]![1]).toBe("judge");
    chat.mockResolvedValueOnce({ ok: true, data: { resultado: "bien", notas: [], arreglo: "algo" } });
    const bien = await reviewConversation({ organizationId: "org_1", snapshot, client, transcript: [], handedOff: true });
    expect(bien).toMatchObject({ veredicto: "verde", review: { arreglo: null } });
    chat.mockResolvedValueOnce({ ok: false, error: "invalid_output", detail: "raw" });
    expect((await reviewConversation({ organizationId: "org_1", snapshot, client, transcript: [], handedOff: false })).status).toBe("judge_failed");
  });

  it("puntaje: verde 1, amarillo 0.5, rojo 0; sin revisar fuera del denominador", () => {
    expect(
      computeScore([
        { status: "done", veredicto: "verde" },
        { status: "done", veredicto: "amarillo" },
        { status: "done", veredicto: "rojo" },
        { status: "judge_failed", veredicto: null },
      ])
    ).toBe(50);
    expect(computeScore([{ status: "judge_failed", veredicto: null }])).toBeNull();
  });

  it("clientsOf tolera snapshots viejos", () => {
    expect(clientsOf(null)).toEqual([]);
    expect(clientsOf({ clients: [client, { nada: 1 }] })).toEqual([client]);
  });
});
