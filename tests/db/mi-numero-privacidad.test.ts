import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { DeviceMessage } from "@/lib/direct-inbound";
import { runWithOrganization } from "@/lib/request-context";
import { subscribe, type SseEvent } from "@/server/events/bus";
import { accessOverview, decideAccess, overlapsFor, requestAccess, sharedChatMessages } from "@/server/mi-numero/access";
import { listMyChats, markClient } from "@/server/mi-numero/chats";
import { ingestNumberMessages } from "@/server/mi-numero/inbound";
import { MiNumeroFailure } from "@/server/mi-numero/numbers";
import { forgetOrgModules } from "@/server/modules";
import { updateOrgModules } from "@/server/modules/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Mi número (046), PR 6b — «También habla con…», pedir ver un chat y la
 * bitácora, contra Postgres real (RLS):
 *
 * - El aviso solo entre chats «Es cliente» de números con el aviso
 *   encendido, y es parejo; solo nombre y fecha.
 * - Pedir ver: solo quien también atiende al cliente y solo si el dueño
 *   permite solicitudes; el dueño decide y puede quitarlo.
 * - Con acceso, solo lectura; cada vista queda en la bitácora del dueño.
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
  const keyId = `PRIV${++seq}${Date.now()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    keyId,
    fromMe: false,
    phone,
    lid: null,
    pushName: "María",
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

describe("Mi número — «También habla con…» y pedir ver un chat (PR 6b)", () => {
  let A: Org;
  let ana: string;
  let luis: string;
  let rosa: string;
  let numAna: string;
  let numLuis: string;
  let numRosa: string;
  let chatAna: string;
  let chatLuis: string;
  let chatRosa: string;
  const MARIA = "525566660001";

  const ponerNumero = (id: string, set: Partial<typeof schema.directNumber.$inferInsert>) =>
    sys().update(schema.directNumber).set(set).where(eq(schema.directNumber.id, id));

  beforeAll(async () => {
    A = await crearOrganizacion("MiNumero privacidad A");
    ana = await crearMiembro(A.id, "Ana");
    luis = await crearMiembro(A.id, "Luis");
    rosa = await crearMiembro(A.id, "Rosa");
    await updateOrgModules(A.id, { conexionDirecta: true, miNumero: true, miNumeroMax: 3 }, "prueba");
    forgetOrgModules(A.id);
    [numAna, numLuis, numRosa] = [newId("directNumber"), newId("directNumber"), newId("directNumber")];
    await sys().insert(schema.directNumber).values([
      { id: numAna, organizationId: A.id, userId: ana, noticeAcceptedAt: new Date(), shareClients: true, overlapNotice: true },
      { id: numLuis, organizationId: A.id, userId: luis, noticeAcceptedAt: new Date(), shareClients: true, overlapNotice: true },
      { id: numRosa, organizationId: A.id, userId: rosa, noticeAcceptedAt: new Date(), shareClients: true, overlapNotice: false },
    ]);
    for (const [num, who] of [
      [numAna, ana],
      [numLuis, luis],
      [numRosa, rosa],
    ] as const) {
      await ingestNumberMessages({ organizationId: A.id, directNumberId: num }, [msg(MARIA, `hola, soy María (${who})`)]);
    }
    chatAna = (await as(A.id, () => listMyChats(A.id, ana))).chats[0]!.id;
    chatLuis = (await as(A.id, () => listMyChats(A.id, luis))).chats[0]!.id;
    chatRosa = (await as(A.id, () => listMyChats(A.id, rosa))).chats[0]!.id;
  });

  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
    await sys().delete(schema.user).where(inArray(schema.user.id, [ana, luis, rosa]));
  });

  it("sin «Es cliente» no hay aviso; con los dos marcados y el aviso encendido, solo nombre y fecha", async () => {
    expect(await as(A.id, () => overlapsFor(A.id, ana, chatAna))).toEqual([]);
    await as(A.id, () => markClient(A.id, ana, chatAna));
    expect(await as(A.id, () => overlapsFor(A.id, ana, chatAna))).toEqual([]);
    await as(A.id, () => markClient(A.id, luis, chatLuis));
    await as(A.id, () => markClient(A.id, rosa, chatRosa));
    const vistos = await as(A.id, () => overlapsFor(A.id, ana, chatAna));
    // Rosa tiene el aviso apagado: no aparece (y ella tampoco ve a nadie).
    expect(vistos.map((o) => o.userName)).toEqual(["Luis"]);
    expect(Object.keys(vistos[0]!).sort()).toEqual(["access", "canRequest", "conversationId", "since", "userName"]);
    expect(vistos[0]).toMatchObject({ canRequest: false, access: "none" });
    expect(await as(A.id, () => overlapsFor(A.id, rosa, chatRosa))).toEqual([]);
  });

  it("pedir ver: solo si el dueño lo permite y solo quien también atiende al cliente", async () => {
    expect(await falla(as(A.id, () => requestAccess(A.id, ana, chatAna, chatLuis)))).toBe("requests_off");
    await ponerNumero(numLuis, { allowViewRequests: true });
    // Rosa no tiene el aviso encendido: no puede pedir.
    expect(await falla(as(A.id, () => requestAccess(A.id, rosa, chatRosa, chatLuis)))).toBe("not_found");
    // Ni pedir con un chat que no es suyo.
    expect(await falla(as(A.id, () => requestAccess(A.id, ana, chatLuis, chatLuis)))).toBe("not_found");
    const eventos: SseEvent[] = [];
    const off = subscribe(A.id, (e) => eventos.push(e));
    await as(A.id, () => requestAccess(A.id, ana, chatAna, chatLuis));
    off();
    expect(eventos.map((e) => (e as { audience?: string[] }).audience)).toEqual([[luis]]);
    expect((await as(A.id, () => overlapsFor(A.id, ana, chatAna)))[0]!.access).toBe("pending");
    // Sin aceptar, no lo puede leer.
    expect(await falla(as(A.id, () => sharedChatMessages(A.id, ana, chatLuis)))).toBe("not_found");
  });

  it("solo el dueño decide; con acceso, solo lectura y cada vista queda anotada", async () => {
    const { incoming } = await as(A.id, () => accessOverview(A.id, luis));
    expect(incoming).toMatchObject([{ requesterName: "Ana", conversationId: chatLuis }]);
    expect(await falla(as(A.id, () => decideAccess(A.id, ana, incoming[0]!.id, "accept")))).toBe("not_found");
    await as(A.id, () => decideAccess(A.id, luis, incoming[0]!.id, "accept"));

    const antes = (await sys().select().from(schema.conversation).where(eq(schema.conversation.id, chatLuis)))[0]!.unreadCount;
    const mensajes = await as(A.id, () => sharedChatMessages(A.id, ana, chatLuis));
    expect(mensajes.map((m) => m.text)).toEqual(["hola, soy María (" + luis + ")"]);
    // Leerlo no lo marca leído para Luis.
    expect((await sys().select().from(schema.conversation).where(eq(schema.conversation.id, chatLuis)))[0]!.unreadCount).toBe(antes);

    const deLuis = await as(A.id, () => accessOverview(A.id, luis));
    expect(deLuis.granted).toMatchObject([{ userName: "Ana" }]);
    expect(deLuis.views).toMatchObject([{ userName: "Ana" }]);
    expect((await as(A.id, () => accessOverview(A.id, ana))).sharedWithMe).toMatchObject([{ ownerName: "Luis", conversationId: chatLuis }]);
    // Rosa no tiene nada que ver.
    expect(await falla(as(A.id, () => sharedChatMessages(A.id, rosa, chatLuis)))).toBe("not_found");
  });

  it("quitar el acceso lo cierra al momento", async () => {
    const { granted } = await as(A.id, () => accessOverview(A.id, luis));
    await as(A.id, () => decideAccess(A.id, luis, granted[0]!.id, "revoke"));
    expect(await falla(as(A.id, () => sharedChatMessages(A.id, ana, chatLuis)))).toBe("not_found");
    expect((await as(A.id, () => overlapsFor(A.id, ana, chatAna)))[0]!.access).toBe("none");
    // Se puede volver a pedir.
    await as(A.id, () => requestAccess(A.id, ana, chatAna, chatLuis));
    expect((await as(A.id, () => accessOverview(A.id, luis))).incoming).toHaveLength(1);
  });
});
