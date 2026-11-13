import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import type { Access } from "@/lib/db/tenant";
import { assignContacts } from "@/server/assignment/assign";
import { getChatView, saveChatView } from "@/server/chat-visibility";
import { listConversations } from "@/server/inbox/queries";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Qué chats ve un ASESOR: solo los suyos (de siempre), los suyos y los que
 * nadie tiene, o todos; y «Tomar este chat» solo gana el primero.
 */
type Org = Awaited<ReturnType<typeof crearOrganizacion>>;

describe("visibilidad de los asesores", () => {
  let A: Org;
  const ana = newId("user");
  const beto = newId("user");
  const ids: Record<string, string> = {};
  const acceso = (userId: string, chatView: Access["chatView"]): Access => ({
    organizationId: A.id,
    userId,
    seesAll: false,
    chatView,
  });

  async function chat(clave: string, assignedTo: string | null) {
    const contactId = newId("contact");
    const tel = `5255${Math.floor(1e7 + Math.random() * 9e7)}`;
    await runWithOrganization(A.id, async () => {
      const db = getDb();
      await db.insert(schema.contact).values({
        id: contactId,
        organizationId: A.id,
        waIdentity: tel,
        phone: tel,
        name: `Cliente ${clave}`,
        assignedUserId: assignedTo,
      });
      await db.insert(schema.conversation).values({
        id: newId("conversation"),
        organizationId: A.id,
        contactId,
        unreadCount: 1,
        lastInboundAt: new Date(),
        lastMessageAt: new Date(),
      });
    });
    ids[clave] = contactId;
  }

  const nombres = async (a: Access) =>
    (await runWithOrganization(A.id, () => listConversations(a))).map((c) => c.contact.name).sort();

  beforeAll(async () => {
    A = await crearOrganizacion("Visibilidad A");
    const sys = getSystemDb();
    for (const id of [ana, beto]) {
      await sys.insert(schema.user).values({ id, name: `Persona ${id}`, email: `${id}@x.test`, emailVerified: true });
      await sys.insert(schema.member).values({ id: newId("member"), organizationId: A.id, userId: id, role: "asesor" });
    }
    await chat("de-ana", ana);
    await chat("de-beto", beto);
    await chat("libre", null);
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
    for (const id of [ana, beto]) await getSystemDb().delete(schema.user).where(eq(schema.user.id, id));
  });

  it("solo los suyos: lo de siempre", async () => {
    expect(await nombres(acceso(ana, "own"))).toEqual(["Cliente de-ana"]);
    expect(await nombres(acceso(ana, undefined))).toEqual(["Cliente de-ana"]);
  });

  it("los suyos y los sin asignar: no ve los de otro asesor", async () => {
    expect(await nombres(acceso(ana, "unassigned"))).toEqual(["Cliente de-ana", "Cliente libre"]);
  });

  it("todos: ve también los de otro asesor", async () => {
    expect(await nombres(acceso(ana, "all"))).toEqual(["Cliente de-ana", "Cliente de-beto", "Cliente libre"]);
  });

  it("Tomar este chat: el primero se lo queda y el segundo recibe «ya asignado»", async () => {
    const tomar = (userId: string) =>
      runWithOrganization(A.id, () =>
        assignContacts({
          organizationId: A.id,
          contactIds: [ids["libre"]!],
          toUserId: userId,
          actorUserId: userId,
          source: "manual",
          reason: "tomado",
          onlyIfUnassigned: true,
        })
      );
    const primero = await tomar(ana);
    expect(primero.ok).toBe(true);
    const segundo = await tomar(beto);
    expect(segundo).toEqual({ ok: false, reason: "already_assigned" });
    // Ya es de Ana: con «solo los suyos» Ana lo ve y Beto no.
    expect(await nombres(acceso(ana, "own"))).toEqual(["Cliente de-ana", "Cliente libre"]);
    expect(await nombres(acceso(beto, "own"))).toEqual(["Cliente de-beto"]);
  });

  it("el ajuste de la empresa se guarda y vuelve; sin él, solo los suyos", async () => {
    expect(await runWithOrganization(A.id, () => getChatView(A.id))).toBe("own");
    await runWithOrganization(A.id, () => saveChatView(A.id, "unassigned"));
    expect(await runWithOrganization(A.id, () => getChatView(A.id))).toBe("unassigned");
  });
});
