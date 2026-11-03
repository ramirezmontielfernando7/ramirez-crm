import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sessionContext } from "@/lib/auth/session";
import type { AssistantProposal } from "@/lib/assistant-engine";
import { runWithOrganization } from "@/lib/request-context";
import { resolveProposals } from "@/server/assistant/apply";
import { saveExchange } from "@/server/assistant/threads";
import { saveConnectorSettings } from "@/server/ai-connector/settings";
import { forgetOrgModules } from "@/server/modules/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

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
    { id: "p2", tool: "send_message", label: "Mandar mensaje", args: { conversation_id: conversationId, text: "hola" }, status: "pending" },
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
  it("aplicar corre lo permitido y rechaza lo que no está en la lista (enviar mensajes)", async () => {
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
