import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { DeviceMessage } from "@/lib/direct-inbound";
import { runWithOrganization } from "@/lib/request-context";
import { listConversations } from "@/server/inbox/queries";
import { getOrCreateContact } from "@/server/inbox/ingest";
import { listMyChats, markClient } from "@/server/mi-numero/chats";
import { ingestNumberMessages } from "@/server/mi-numero/inbound";
import { revokeNumber } from "@/server/mi-numero/numbers";
import { forgetOrgModules } from "@/server/modules";
import { updateOrgModules } from "@/server/modules/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Mi número (046), PR 6 — Revocar el número de una persona hace lo que ella
 * aceptó en su aviso, contra Postgres real (RLS):
 *
 * - Los chats que marcó «Es cliente» pasan a la empresa (a la Bandeja, o se
 *   juntan con el chat que la empresa ya tenía con ese cliente).
 * - Sus chats privados se borran con sus archivos; sus contactos privados
 *   también, salvo que otro número siga hablando con ellos.
 * - Lo de otros números no se toca.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const sys = () => getSystemDb();
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

async function crearMiembro(organizationId: string, name: string, role = "asesor"): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@x.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId, userId: id, role });
  return id;
}

let seq = 0;
function msg(phone: string, text: string, opts: { image?: boolean } = {}): DeviceMessage {
  const keyId = `BAJA${++seq}${Date.now()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    keyId,
    fromMe: false,
    phone,
    lid: null,
    pushName: "Cliente",
    timestamp: ts,
    message: (opts.image
      ? { type: "image", image: { id: `direct:${keyId}`, mime_type: "image/jpeg" }, id: `direct.${keyId}`, timestamp: ts }
      : { type: "text", text: { body: text }, id: `direct.${keyId}`, timestamp: ts, from: phone }) as DeviceMessage["message"],
  };
}

describe("Mi número — revocar: los clientes se quedan, lo privado se borra (PR 6)", () => {
  let A: Org;
  let fer: string;
  let ana: string;
  let luis: string;
  let numAna: string;
  let numLuis: string;

  const PRIVADO = "525544440001";
  const CLIENTE_NUEVO = "525544440002";
  const CLIENTE_CON_EMPRESA = "525544440003";
  const COMPARTIDO = "525544440004";

  const contacto = async (phone: string) => (await sys().select().from(schema.contact).where(eq(schema.contact.waIdentity, phone)))[0];
  const chatsDe = async (contactId: string) => sys().select().from(schema.conversation).where(eq(schema.conversation.contactId, contactId));

  beforeAll(async () => {
    A = await crearOrganizacion("MiNumero baja A");
    fer = await crearMiembro(A.id, "Fer", "owner");
    ana = await crearMiembro(A.id, "Ana");
    luis = await crearMiembro(A.id, "Luis");
    await updateOrgModules(A.id, { conexionDirecta: true, miNumero: true, miNumeroMax: 3 }, "prueba");
    forgetOrgModules(A.id);
    numAna = newId("directNumber");
    numLuis = newId("directNumber");
    await sys().insert(schema.directNumber).values([
      { id: numAna, organizationId: A.id, userId: ana, noticeAcceptedAt: new Date(), shareClients: true },
      { id: numLuis, organizationId: A.id, userId: luis, noticeAcceptedAt: new Date() },
    ]);
    // La empresa ya habla con este cliente.
    await as(A.id, () => getOrCreateContact(A.id, CLIENTE_CON_EMPRESA, "Cliente con empresa"));
    const cEmp = await contacto(CLIENTE_CON_EMPRESA);
    await sys().insert(schema.conversation).values({ id: newId("conversation"), organizationId: A.id, contactId: cEmp!.id });

    const ref = { organizationId: A.id, directNumberId: numAna };
    await ingestNumberMessages(ref, [msg(PRIVADO, "hola"), msg(PRIVADO, "", { image: true })]);
    await ingestNumberMessages(ref, [msg(CLIENTE_NUEVO, "quiero cotizar")]);
    await ingestNumberMessages(ref, [msg(CLIENTE_CON_EMPRESA, "otra vez yo")]);
    await ingestNumberMessages(ref, [msg(COMPARTIDO, "hola Ana")]);
    await ingestNumberMessages({ organizationId: A.id, directNumberId: numLuis }, [msg(COMPARTIDO, "hola Luis")]);
    // El adjunto ya está en disco (como si se hubiera descargado).
    await sys().update(schema.mediaAsset).set({ fetchStatus: "available" }).where(like(schema.mediaAsset.waMediaId, `dnum:${numAna}:%`));

    const mios = (await as(A.id, () => listMyChats(A.id, ana))).chats;
    for (const phone of [CLIENTE_NUEVO, CLIENTE_CON_EMPRESA]) {
      const c = mios.find((x) => x.contact.phone === phone)!;
      await as(A.id, () => markClient(A.id, ana, c.id));
    }
  });

  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
    await sys().delete(schema.user).where(inArray(schema.user.id, [fer, ana, luis]));
  });

  it("revocar deja lo que aceptó Ana", async () => {
    await as(A.id, () => revokeNumber(A.id, numAna));

    // Lo privado: fuera chat, archivos y contacto.
    expect(await contacto(PRIVADO)).toBeUndefined();
    expect(await sys().select().from(schema.mediaAsset).where(like(schema.mediaAsset.waMediaId, `dnum:${numAna}:%`))).toHaveLength(0);
    expect(await sys().select().from(schema.conversation).where(eq(schema.conversation.directNumberId, numAna))).toHaveLength(0);

    // Cliente sin chat de la empresa: su chat pasa a la Bandeja.
    const nuevo = await contacto(CLIENTE_NUEVO);
    const [chatNuevo] = await chatsDe(nuevo!.id);
    expect(chatNuevo).toMatchObject({ directNumberId: null });
    expect(nuevo!.privateToNumberId).toBeNull();
    const bandeja = await as(A.id, () => listConversations({ organizationId: A.id, userId: fer, seesAll: true }));
    expect(bandeja.some((c) => c.id === chatNuevo!.id)).toBe(true);

    // Cliente que ya tenía chat con la empresa: los mensajes se juntan ahí.
    const conEmpresa = await contacto(CLIENTE_CON_EMPRESA);
    const chats = await chatsDe(conEmpresa!.id);
    expect(chats).toHaveLength(1);
    const textos = await sys().select({ text: schema.message.text }).from(schema.message).where(eq(schema.message.conversationId, chats[0]!.id));
    expect(textos.map((t) => t.text)).toContain("otra vez yo");

    // Quien también habla con Luis: sigue, ahora privado del número de Luis.
    const compartido = await contacto(COMPARTIDO);
    expect(compartido!.privateToNumberId).toBe(numLuis);
    expect((await chatsDe(compartido!.id)).map((c) => c.directNumberId)).toEqual([numLuis]);
    expect((await as(A.id, () => listMyChats(A.id, luis))).chats).toHaveLength(1);
  });
});
