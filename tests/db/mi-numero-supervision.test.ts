import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { DeviceMessage } from "@/lib/direct-inbound";
import { runWithOrganization } from "@/lib/request-context";
import { subscribe, type SseEvent } from "@/server/events/bus";
import { accessOverview, decideAccess, sharedChatMessages } from "@/server/mi-numero/access";
import { listMyChats, markClient } from "@/server/mi-numero/chats";
import { ingestNumberMessages } from "@/server/mi-numero/inbound";
import { MiNumeroFailure } from "@/server/mi-numero/numbers";
import { companyNumberChatMessages, requestAccessAsSupervisor, teamNumbers } from "@/server/mi-numero/supervise";
import { forgetOrgModules } from "@/server/modules";
import { updateOrgModules } from "@/server/modules/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Mi número (046), PR 7 — Quien supervisa (Propietario y Coordinador),
 * contra Postgres real (RLS):
 *
 * - Lee los chats de los números «de la empresa» en solo lectura: no los
 *   marca leídos y cada vista queda anotada. Se entera en vivo de lo que
 *   entra a esos números; de los personales, nunca.
 * - De un número personal solo ve los chats que su dueño marcó «Es cliente»
 *   y deja pedir; puede pedir verlos sin atender al cliente y decide el dueño.
 * - Un Asesor no supervisa nada.
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
function msg(phone: string, text: string): DeviceMessage {
  const keyId = `SUP${++seq}${Date.now()}`;
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

async function falla(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    if (err instanceof MiNumeroFailure) return err.code;
    throw err;
  }
}

describe("Mi número — supervisar los números del equipo (PR 7)", () => {
  let A: Org;
  let fer: string;
  let coord: string;
  let ana: string;
  let luis: string;
  let rosa: string;
  let numAna: string;
  let numLuis: string;
  let chatLuis: string;
  let clienteAna: string;
  let privadoAna: string;
  const eventos: SseEvent[] = [];
  let off: () => void = () => {};

  beforeAll(async () => {
    A = await crearOrganizacion("MiNumero supervision A");
    fer = await crearMiembro(A.id, "Fer", "owner");
    coord = await crearMiembro(A.id, "Coco", "coordinador");
    ana = await crearMiembro(A.id, "Ana");
    luis = await crearMiembro(A.id, "Luis");
    rosa = await crearMiembro(A.id, "Rosa");
    await updateOrgModules(A.id, { conexionDirecta: true, miNumero: true, miNumeroMax: 3 }, "prueba");
    forgetOrgModules(A.id);
    numAna = newId("directNumber");
    numLuis = newId("directNumber");
    await sys().insert(schema.directNumber).values([
      { id: numAna, organizationId: A.id, userId: ana, noticeAcceptedAt: new Date(), shareClients: true, allowViewRequests: true },
      { id: numLuis, organizationId: A.id, userId: luis, kind: "empresa", label: "Ventas 2", noticeAcceptedAt: new Date() },
    ]);
    off = subscribe(A.id, (e) => eventos.push(e));
    await ingestNumberMessages({ organizationId: A.id, directNumberId: numLuis }, [msg("525577770001", "hola empresa")]);
    await ingestNumberMessages({ organizationId: A.id, directNumberId: numAna }, [msg("525577770002", "quiero cotizar")]);
    await ingestNumberMessages({ organizationId: A.id, directNumberId: numAna }, [msg("525577770003", "soy tu tía")]);
    chatLuis = (await as(A.id, () => listMyChats(A.id, luis))).chats[0]!.id;
    const deAna = (await as(A.id, () => listMyChats(A.id, ana))).chats;
    clienteAna = deAna.find((c) => c.contact.phone === "525577770002")!.id;
    privadoAna = deAna.find((c) => c.contact.phone === "525577770003")!.id;
    await as(A.id, () => markClient(A.id, ana, clienteAna));
  });

  afterAll(async () => {
    off();
    await borrarOrganizaciones([A.id]);
    await sys().delete(schema.user).where(inArray(schema.user.id, [fer, coord, ana, luis, rosa]));
  });

  it("lo que entra a un número de la empresa llega en vivo a quien supervisa; lo de un personal, solo a su dueño", () => {
    const audiencias = eventos
      .filter((e) => e.type === "number.message")
      .map((e) => [...((e as { audience?: string[] }).audience ?? [])].sort());
    expect(audiencias[0]).toEqual([coord, fer, luis].sort());
    expect(audiencias[1]).toEqual([ana]);
    expect(audiencias[2]).toEqual([ana]);
  });

  it("el Coordinador ve el número de la empresa y solo los chats de cliente que Ana deja pedir", async () => {
    const vista = await as(A.id, () => teamNumbers(A.id, coord));
    expect(vista.companyNumbers).toMatchObject([{ numberId: numLuis, ownerName: "Luis", label: "Ventas 2", chats: [{ id: chatLuis }] }]);
    expect(vista.requestable.map((r) => r.conversationId)).toEqual([clienteAna]);
    expect(vista.requestable[0]).toMatchObject({ ownerName: "Ana", access: "none" });
  });

  it("un Asesor no supervisa", async () => {
    expect(await falla(as(A.id, () => teamNumbers(A.id, rosa)))).toBe("not_found");
    expect(await falla(as(A.id, () => companyNumberChatMessages(A.id, rosa, chatLuis)))).toBe("not_found");
    expect(await falla(as(A.id, () => requestAccessAsSupervisor(A.id, rosa, clienteAna)))).toBe("not_found");
  });

  it("leer un chat de la empresa: solo lectura, no lo marca leído y queda anotado; un personal, jamás", async () => {
    const antes = (await sys().select().from(schema.conversation).where(eq(schema.conversation.id, chatLuis)))[0]!.unreadCount;
    const mensajes = await as(A.id, () => companyNumberChatMessages(A.id, coord, chatLuis));
    expect(mensajes.map((m) => m.text)).toEqual(["hola empresa"]);
    expect((await sys().select().from(schema.conversation).where(eq(schema.conversation.id, chatLuis)))[0]!.unreadCount).toBe(antes);
    const vistas = await sys()
      .select()
      .from(schema.conversationAccessLog)
      .where(and(eq(schema.conversationAccessLog.conversationId, chatLuis), eq(schema.conversationAccessLog.userId, coord)));
    expect(vistas).toHaveLength(1);
    expect((await as(A.id, () => accessOverview(A.id, luis))).views).toMatchObject([{ userName: "Coco" }]);
    expect(await falla(as(A.id, () => companyNumberChatMessages(A.id, coord, clienteAna)))).toBe("not_found");
    expect(await falla(as(A.id, () => companyNumberChatMessages(A.id, coord, privadoAna)))).toBe("not_found");
  });

  it("pedir ver un chat de cliente sin atenderlo: decide Ana; lo privado no se puede pedir", async () => {
    expect(await falla(as(A.id, () => requestAccessAsSupervisor(A.id, coord, privadoAna)))).toBe("not_found");
    await as(A.id, () => requestAccessAsSupervisor(A.id, coord, clienteAna));
    expect((await as(A.id, () => teamNumbers(A.id, coord))).requestable[0]!.access).toBe("pending");
    expect(await falla(as(A.id, () => sharedChatMessages(A.id, coord, clienteAna)))).toBe("not_found");

    const { incoming } = await as(A.id, () => accessOverview(A.id, ana));
    expect(incoming).toMatchObject([{ requesterName: "Coco", requesterRole: "Coordinador", conversationId: clienteAna }]);
    await as(A.id, () => decideAccess(A.id, ana, incoming[0]!.id, "accept"));
    expect((await as(A.id, () => sharedChatMessages(A.id, coord, clienteAna))).map((m) => m.text)).toEqual(["quiero cotizar"]);
    expect((await as(A.id, () => accessOverview(A.id, coord))).sharedWithMe).toMatchObject([{ ownerName: "Ana", conversationId: clienteAna }]);
  });

  it("si Ana apaga las solicitudes, nadie más puede pedir", async () => {
    await sys().update(schema.directNumber).set({ allowViewRequests: false }).where(eq(schema.directNumber.id, numAna));
    expect((await as(A.id, () => teamNumbers(A.id, fer))).requestable).toEqual([]);
    expect(await falla(as(A.id, () => requestAccessAsSupervisor(A.id, fer, clienteAna)))).toBe("requests_off");
  });
});
