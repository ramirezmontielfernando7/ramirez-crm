import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sessionContext } from "@/lib/auth/session";
import type { AssistantProposal } from "@/lib/assistant-engine";
import { runWithOrganization } from "@/lib/request-context";
import { resolveProposals } from "@/server/assistant/apply";
import { saveExchange } from "@/server/assistant/threads";
import { saveConnectorSettings } from "@/server/ai-connector/settings";
import { forgetOrgModules } from "@/server/modules/store";
import { assistantTools, sendingLabel } from "@/server/assistant/tools";
import { toolsFor } from "@/server/ai-connector/tools";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

const send = vi.hoisted(() => ({ sendText: vi.fn() }));
vi.mock("@/server/inbox/send", async (original) => ({
  ...(await original<typeof import("@/server/inbox/send")>()),
  sendText: send.sendText,
}));

/**
 * Asistente — los cambios que PROPONE solo corren cuando la persona pulsa
 * «Aplicar», con su sesión y por las herramientas del conector; «Cancelar» no
 * toca nada y un cambio ya resuelto no se aplica dos veces.
 */

const sys = () => getSystemDb();
let A: Awaited<ReturnType<typeof crearOrganizacion>>;
let ownerId = "";
let contactId = "";
let conversationId = "";

function propuestas(): AssistantProposal[] {
  return [
    { id: "p1", tool: "add_note", label: "Anotar en el chat", args: { conversation_id: conversationId, text: "Pidió llamada mañana" }, status: "pending" },
    { id: "p2", tool: "borrar_todo", label: "Borrar todo", args: {}, status: "pending" },
  ];
}

async function respuesta(proposals: AssistantProposal[]) {
  const s = await runWithOrganization(A.id, () =>
    saveExchange({
      organizationId: A.id,
      userId: ownerId,
      threadId: null,
      question: "anota y avisa",
      maskedQuestion: "anota y avisa",
      answer: "Propongo estos cambios",
      maskedAnswer: "Propongo estos cambios",
      meta: { sources: [], flags: [], queryCount: 0, modelCalls: 1, proposals },
      usage: { promptTokens: 1, completionTokens: 1 },
    })
  );
  return { threadId: s.threadId, messageId: s.answer.id };
}

beforeAll(async () => {
  A = await crearOrganizacion("Acciones A");
  ownerId = newId("user");
  await sys().insert(schema.user).values({ id: ownerId, name: "Dueña", email: `${ownerId}@acc.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: A.id, userId: ownerId, role: "owner" });
  contactId = newId("contact");
  await sys().insert(schema.contact).values({ id: contactId, organizationId: A.id, waIdentity: "5215511110000", phone: "5215511110000", name: "Laura" });
  conversationId = newId("conversation");
  await sys().insert(schema.conversation).values({ id: conversationId, organizationId: A.id, contactId, lastMessageAt: new Date(), lastInboundAt: new Date() });
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: A.id, conectorIa: true, trabajo: true, asistente: true })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { conectorIa: true, trabajo: true, asistente: true } });
  forgetOrgModules(A.id);
  await runWithOrganization(A.id, () => saveConnectorSettings(A.id, ownerId, { enabled: true, allowedRoles: ["coordinador", "asesor"], dailyMessageLimit: 50 }));
});

afterAll(async () => {
  await borrarOrganizaciones([A.id]);
  await sys().delete(schema.user).where(eq(schema.user.id, ownerId));
});

const session = () => sessionContext(ownerId, A.id, "owner");
const notas = async () => (await sys().select().from(schema.contactActivityEvent).where(eq(schema.contactActivityEvent.contactId, contactId))).length;

describe("asistente — aplicar y cancelar lo propuesto", () => {
  it("aplicar corre lo permitido y rechaza lo que no existe en el conector", async () => {
    const { threadId, messageId } = await respuesta(propuestas());
    const antes = await notas();
    const r = await runWithOrganization(A.id, () => resolveProposals({ session: session(), threadId, messageId, action: "apply" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposals.find((p) => p.id === "p1")?.status).toBe("applied");
    expect(r.proposals.find((p) => p.id === "p2")?.status).toBe("failed");
    expect(await notas()).toBe(antes + 1);
    // Ya resueltas: no se aplican dos veces.
    const otra = await runWithOrganization(A.id, () => resolveProposals({ session: session(), threadId, messageId, action: "apply" }));
    expect(otra.ok).toBe(false);
    expect(await notas()).toBe(antes + 1);
  });

  it("cancelar no toca nada", async () => {
    const { threadId, messageId } = await respuesta(propuestas());
    const antes = await notas();
    const r = await runWithOrganization(A.id, () => resolveProposals({ session: session(), threadId, messageId, action: "cancel" }));
    expect(r.ok && r.proposals.every((p) => p.status === "cancelled")).toBe(true);
    expect(await notas()).toBe(antes);
  });

  it("el hilo es de quien lo abrió: otra persona no aplica nada", async () => {
    const { threadId, messageId } = await respuesta(propuestas());
    const otra = newId("user");
    const r = await runWithOrganization(A.id, () => resolveProposals({ session: sessionContext(otra, A.id, "owner"), threadId, messageId, action: "apply" }));
    expect(r.ok).toBe(false);
  });
});

describe("asistente — enviar mensajes solo con «Aplicar»", () => {
  const envio = (): AssistantProposal[] => [
    { id: "p1", tool: "send_message", label: "x", args: { conversation_id: conversationId, text: "Hola Laura, ¿te llamo mañana?" }, status: "pending" },
  ];

  beforeEach(() => {
    send.sendText.mockReset();
    send.sendText.mockResolvedValue({ messageId: "msg_prueba", queuedUntil: null });
  });

  it("proponer no envía; «Aplicar» envía como «Asistente», por la misma vía de la Bandeja, y queda en la bitácora", async () => {
    const { threadId, messageId } = await respuesta(envio());
    expect(send.sendText).not.toHaveBeenCalled();
    const r = await runWithOrganization(A.id, () => resolveProposals({ session: session(), threadId, messageId, action: "apply" }));
    expect(r.ok && r.proposals[0]?.status).toBe("applied");
    expect(send.sendText).toHaveBeenCalledTimes(1);
    expect(send.sendText.mock.calls[0]?.[0]).toMatchObject({
      conversationId,
      organizationId: A.id,
      text: "Hola Laura, ¿te llamo mañana?",
      aiConnectionId: "assistant",
      aiSenderName: "Asistente",
      allowDirect: true,
    });
    const filas = await sys().select().from(schema.aiActionLog).where(eq(schema.aiActionLog.userId, ownerId));
    const fila = filas.find((f) => f.tool === "send_message");
    expect(fila?.connectionId).toBe("assistant");
    expect(fila?.outcome).toBe("ok");
    // Ya resuelto: no se manda dos veces.
    const otra = await runWithOrganization(A.id, () => resolveProposals({ session: session(), threadId, messageId, action: "apply" }));
    expect(otra.ok).toBe(false);
    expect(send.sendText).toHaveBeenCalledTimes(1);
  });

  it("«Cancelar» no envía nada", async () => {
    const { threadId, messageId } = await respuesta(envio());
    await runWithOrganization(A.id, () => resolveProposals({ session: session(), threadId, messageId, action: "cancel" }));
    expect(send.sendText).not.toHaveBeenCalled();
  });

  it("si la Bandeja rechaza el envío (p. ej. ventana cerrada), queda «No se pudo» con el motivo y no se cuenta como enviado", async () => {
    const { SendError } = await import("@/server/inbox/send");
    send.sendText.mockRejectedValue(new SendError("window_closed", "La ventana de 24 h está cerrada: usa una plantilla."));
    const { threadId, messageId } = await respuesta(envio());
    const r = await runWithOrganization(A.id, () => resolveProposals({ session: session(), threadId, messageId, action: "apply" }));
    expect(r.ok && r.proposals[0]?.status).toBe("failed");
    expect(r.ok && r.proposals[0]?.result).toMatch(/ventana/i);
  });

  it("con el envío apagado en la empresa (tope 0) no sale nada", async () => {
    await runWithOrganization(A.id, () => saveConnectorSettings(A.id, ownerId, { enabled: true, allowedRoles: ["coordinador", "asesor"], dailyMessageLimit: 0 }));
    try {
      const { threadId, messageId } = await respuesta(envio());
      const r = await runWithOrganization(A.id, () => resolveProposals({ session: session(), threadId, messageId, action: "apply" }));
      expect(r.ok && r.proposals[0]?.status).toBe("failed");
      expect(send.sendText).not.toHaveBeenCalled();
    } finally {
      await runWithOrganization(A.id, () => saveConnectorSettings(A.id, ownerId, { enabled: true, allowedRoles: ["coordinador", "asesor"], dailyMessageLimit: 50 }));
    }
  });

  it("el texto de la propuesta lo arma el servidor: a quién y qué sale", async () => {
    const label = await runWithOrganization(A.id, () => sendingLabel(session(), "send_message", { conversation_id: conversationId, text: "Hola\n  Laura" }));
    expect(label).toBe("Enviar a Laura: «Hola Laura»");
    expect(await runWithOrganization(A.id, () => sendingLabel(session(), "add_note", {}))).toBeNull();
  });
});

describe("asistente — mismas herramientas que el conector", () => {
  it("tiene todas las que el conector le daría a esta persona hoy, menos los enlaces de subida; y las de envío son de cambio", async () => {
    const conector = (await runWithOrganization(A.id, () => toolsFor(session(), ["read", "write"]))).map((t) => t.name);
    const t = await runWithOrganization(A.id, () => assistantTools(session()));
    const asistente = [...t.read, ...t.write].map((x) => x.name).sort();
    expect(asistente).toEqual(conector.filter((n) => !/^(create|check)_upload_link$/.test(n)).sort());
    expect(t.read.length).toBeGreaterThan(10);
    expect(t.write.map((x) => x.name)).toEqual(expect.arrayContaining(["send_message", "send_template", "send_material", "tag_chat"]));
    expect(t.read.map((x) => x.name)).not.toContain("send_message");
  });
});
