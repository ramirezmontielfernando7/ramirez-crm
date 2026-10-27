import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { DeviceMessage } from "@/lib/direct-inbound";
import { runWithOrganization } from "@/lib/request-context";
import { dismissClientPrompt, listMyChats, markClient, openNumberChat, unmarkClient } from "@/server/mi-numero/chats";
import { ingestNumberMessages } from "@/server/mi-numero/inbound";
import { MiNumeroFailure, updateMyNumber } from "@/server/mi-numero/numbers";
import { forgetOrgModules } from "@/server/modules";
import { updateOrgModules } from "@/server/modules/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

vi.mock("@/server/ai/trigger", () => ({ maybeRunAgentTurn: async () => {} }));

/**
 * Mi número — «Marcar chats nuevos como cliente por defecto», «No es cliente»
 * (nada se borra), la pregunta «¿Es cliente? Sí / No» y abrir el chat de un
 * teléfono buscado, contra Postgres real.
 */
type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const sys = () => getSystemDb();
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

let seq = 0;
function msg(phone: string, text: string): DeviceMessage {
  const keyId = `CD${++seq}${Date.now()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    keyId,
    fromMe: false,
    phone,
    lid: null,
    pushName: "Cliente",
    timestamp: ts,
    message: { type: "text", text: { body: text }, id: `direct.${keyId}`, timestamp: ts, from: phone } as DeviceMessage["message"],
  };
}

describe("Mi número — cliente por defecto, «No es cliente» y buscar", () => {
  let A: Org;
  let ana: string;
  let numAna: string;
  const ref = () => ({ organizationId: A.id, directNumberId: numAna });
  const chatOf = async (phone: string) => {
    const [c] = await sys()
      .select({ conversation: schema.conversation, contact: schema.contact })
      .from(schema.conversation)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
      .where(eq(schema.contact.phone, phone));
    return c!;
  };
  const leadsOf = async (contactId: string) => sys().select().from(schema.lead).where(eq(schema.lead.contactId, contactId));

  beforeAll(async () => {
    A = await crearOrganizacion("MiNumero Cliente A");
    ana = newId("user");
    await sys().insert(schema.user).values({ id: ana, name: "Ana", email: `${ana}@x.test`, emailVerified: true });
    await sys().insert(schema.member).values({ id: newId("member"), organizationId: A.id, userId: ana, role: "asesor" });
    await sys().insert(schema.pipelineStage).values({ id: newId("stage"), organizationId: A.id, name: "Nuevo", position: 0, kind: "open" });
    await updateOrgModules(A.id, { conexionDirecta: true, miNumero: true, miNumeroMax: 3 }, "prueba");
    forgetOrgModules(A.id);
    numAna = newId("directNumber");
    await sys().insert(schema.directNumber).values({ id: numAna, organizationId: A.id, userId: ana, noticeAcceptedAt: new Date(), shareClients: true });
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
    await sys().delete(schema.user).where(eq(schema.user.id, ana));
  });

  it("apagado de fábrica: el chat nuevo nace privado", async () => {
    const [n] = await sys().select().from(schema.directNumber).where(eq(schema.directNumber.id, numAna));
    expect(n!.clientByDefault).toBe(false);
    await ingestNumberMessages(ref(), [msg("525500000001", "hola")]);
    const c = await chatOf("525500000001");
    expect(c.conversation.clientMarkedAt).toBeNull();
    expect(c.contact.privateToNumberId).toBe(numAna);
  });

  it("encendido: solo los chats NUEVOS nacen cliente (con ficha); los de antes no cambian", async () => {
    await as(A.id, () => updateMyNumber(A.id, ana, { clientByDefault: true }));
    await ingestNumberMessages(ref(), [msg("525500000001", "otro mensaje"), msg("525500000002", "hola, soy nuevo")]);
    expect((await chatOf("525500000001")).conversation.clientMarkedAt).toBeNull();
    const nuevo = await chatOf("525500000002");
    expect(nuevo.conversation.clientMarkedAt).not.toBeNull();
    expect(nuevo.contact.privateToNumberId).toBeNull();
    expect(nuevo.contact.assignedUserId).toBe(ana);
    expect(await leadsOf(nuevo.contact.id)).toHaveLength(1);
  });

  it("sin «Compartir mis clientes» el chat nuevo sigue privado aunque el interruptor esté encendido", async () => {
    await as(A.id, () => updateMyNumber(A.id, ana, { shareClients: false }));
    await ingestNumberMessages(ref(), [msg("525500000003", "hola")]);
    expect((await chatOf("525500000003")).conversation.clientMarkedAt).toBeNull();
    await as(A.id, () => updateMyNumber(A.id, ana, { shareClients: true }));
  });

  it("«No es cliente»: vuelve a privado, NO se borra el lead y al marcar de nuevo reaparece el mismo", async () => {
    const antes = await chatOf("525500000002");
    const lead = (await leadsOf(antes.contact.id))[0]!;
    await as(A.id, () => unmarkClient(A.id, ana, antes.conversation.id));
    const privado = await chatOf("525500000002");
    expect(privado.conversation.clientMarkedAt).toBeNull();
    expect(privado.contact.privateToNumberId).toBe(numAna);
    expect(privado.contact.assignedUserId).toBe(ana);
    expect((await leadsOf(antes.contact.id)).map((l) => l.id)).toEqual([lead.id]);
    // La pregunta no vuelve a salir después de decir «No».
    const chats = await as(A.id, () => listMyChats(A.id, ana));
    expect(chats.chats.find((c) => c.id === antes.conversation.id)).toMatchObject({ clientMarkedAt: null, clientAsked: true });
    await as(A.id, () => markClient(A.id, ana, antes.conversation.id));
    const otra = await chatOf("525500000002");
    expect(otra.conversation.clientMarkedAt).not.toBeNull();
    expect(otra.contact.privateToNumberId).toBeNull();
    expect((await leadsOf(antes.contact.id)).map((l) => l.id)).toEqual([lead.id]);
  });

  it("«No es cliente» quita los permisos de ver ese chat", async () => {
    const c = await chatOf("525500000002");
    const otro = newId("user");
    await sys().insert(schema.user).values({ id: otro, name: "Luis", email: `${otro}@x.test`, emailVerified: true });
    await sys().insert(schema.member).values({ id: newId("member"), organizationId: A.id, userId: otro, role: "asesor" });
    const acceso = newId("conversationAccess");
    await sys().insert(schema.conversationAccess).values({
      id: acceso,
      organizationId: A.id,
      conversationId: c.conversation.id,
      userId: otro,
      status: "granted",
    });
    await as(A.id, () => unmarkClient(A.id, ana, c.conversation.id));
    const [a] = await sys().select().from(schema.conversationAccess).where(eq(schema.conversationAccess.id, acceso));
    expect(a!.status).toBe("revoked");
    await as(A.id, () => markClient(A.id, ana, c.conversation.id));
  });

  it("si el contacto también tiene chat con la empresa, quitarlo de clientes no lo saca del CRM", async () => {
    const c = await chatOf("525500000002");
    await sys().insert(schema.conversation).values({ id: newId("conversation"), organizationId: A.id, contactId: c.contact.id });
    await as(A.id, () => unmarkClient(A.id, ana, c.conversation.id));
    expect((await chatOf("525500000002")).contact.privateToNumberId).toBeNull();
  });

  it("«¿Es cliente?» → «No» solo esconde la pregunta", async () => {
    const c = await chatOf("525500000003");
    await as(A.id, () => dismissClientPrompt(A.id, ana, c.conversation.id));
    const after = await chatOf("525500000003");
    expect(after.conversation.clientMarkedAt).toBeNull();
    expect(after.contact.privateToNumberId).toBe(numAna);
    expect((await as(A.id, () => listMyChats(A.id, ana))).chats.find((x) => x.id === c.conversation.id)?.clientAsked).toBe(true);
  });

  it("abrir el chat de un teléfono buscado: contacto privado, con nombre, y sin repetirse", async () => {
    await as(A.id, () => updateMyNumber(A.id, ana, { clientByDefault: false }));
    const { conversationId } = await as(A.id, () => openNumberChat(A.id, ana, { phone: "462 123 4567", name: "Rosa Pérez" }));
    const c = await chatOf("524621234567");
    expect(c.conversation.id).toBe(conversationId);
    expect(c.contact).toMatchObject({ name: "Rosa Pérez", privateToNumberId: numAna });
    expect(c.conversation.clientMarkedAt).toBeNull();
    expect((await as(A.id, () => openNumberChat(A.id, ana, { phone: "+52 462 123 4567" }))).conversationId).toBe(conversationId);
  });

  it("abrir un chat con el interruptor encendido nace cliente; un teléfono inválido se rechaza", async () => {
    await as(A.id, () => updateMyNumber(A.id, ana, { clientByDefault: true }));
    const { conversationId } = await as(A.id, () => openNumberChat(A.id, ana, { phone: "55 1111 2222" }));
    const [conv] = await sys().select().from(schema.conversation).where(eq(schema.conversation.id, conversationId));
    expect(conv!.clientMarkedAt).not.toBeNull();
    await expect(as(A.id, () => openNumberChat(A.id, ana, { phone: "123" }))).rejects.toMatchObject({ code: "bad_phone" });
    await expect(as(A.id, () => openNumberChat(A.id, ana, { phone: "123" }))).rejects.toBeInstanceOf(MiNumeroFailure);
  });
});
