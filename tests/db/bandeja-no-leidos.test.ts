import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import type { Access } from "@/lib/db/tenant";
import { countUnread, listConversations } from "@/server/inbox/queries";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * El globo de no leídos del menú usa `countUnread` (GET /api/conversations/unread)
 * en vez de bajar la lista. Debe dar EXACTAMENTE lo que daba sumar `unreadCount`
 * de `listConversations`: incluye archivados, deja fuera pruebas y chats de
 * «Campañas» sin respuesta, respeta al asesor (asignados + participante) y no
 * mira otras organizaciones. Contra Postgres real, conectada como la app.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;

describe("bandeja: no leídos del globo = suma de la lista", () => {
  let A: Org;
  let B: Org;
  const owner = newId("user");
  const asesor = newId("user");
  const otro = newId("user");
  const ownerA = (): Access => ({ organizationId: A.id, userId: owner, seesAll: true });
  const asesorA = (): Access => ({ organizationId: A.id, userId: asesor, seesAll: false });
  const otroA = (): Access => ({ organizationId: A.id, userId: otro, seesAll: false });

  async function chat(
    org: Org,
    name: string,
    unread: number,
    opts: {
      assignedTo?: string;
      archived?: boolean;
      campaignPending?: boolean;
      campaignReplied?: boolean;
      isTest?: boolean;
      participant?: string;
    } = {}
  ) {
    const contactId = newId("contact");
    const tel = `5255${Math.floor(1e7 + Math.random() * 9e7)}`;
    await runWithOrganization(org.id, async () => {
      const db = getDb();
      await db.insert(schema.contact).values({
        id: contactId,
        organizationId: org.id,
        waIdentity: tel,
        phone: tel,
        name,
        assignedUserId: opts.assignedTo ?? null,
      });
      await db.insert(schema.conversation).values({
        id: newId("conversation"),
        organizationId: org.id,
        contactId,
        unreadCount: unread,
        isTest: opts.isTest ?? false,
        archivedAt: opts.archived ? new Date() : null,
        campaignPendingId: opts.campaignPending ? "cmp_x" : null,
        campaignRepliedId: opts.campaignReplied ? "cmp_x" : null,
        lastMessageAt: new Date(),
      });
      if (opts.participant) {
        await db.insert(schema.contactParticipant).values({
          organizationId: org.id,
          contactId,
          userId: opts.participant,
        });
      }
    });
  }

  beforeAll(async () => {
    A = await crearOrganizacion("No leídos A");
    B = await crearOrganizacion("No leídos B");
    const sys = getSystemDb();
    for (const id of [owner, asesor, otro]) {
      await sys.insert(schema.user).values({ id, name: id, email: `${id}@x.test`, emailVerified: true });
    }
    // Org A: de todo un poco.
    await chat(A, "sin asignar", 3);
    await chat(A, "del asesor", 2, { assignedTo: asesor });
    await chat(A, "del asesor, archivado", 5, { assignedTo: asesor, archived: true });
    await chat(A, "sin asignar, archivado", 7, { archived: true });
    await chat(A, "de otro asesor", 4, { assignedTo: otro });
    await chat(A, "participante", 6, { assignedTo: otro, participant: asesor });
    await chat(A, "campaña sin respuesta", 11, { campaignPending: true });
    await chat(A, "respondió a campaña", 13, { campaignReplied: true });
    await chat(A, "del Laboratorio", 17, { isTest: true });
    await chat(A, "sin no leídos", 0, { assignedTo: asesor });
    // Org B: lo suyo no se mezcla con A.
    await chat(B, "otra empresa", 19);
  });

  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
    const sys = getSystemDb();
    for (const id of [owner, asesor, otro]) await sys.delete(schema.user).where(eq(schema.user.id, id));
  });

  const sumaDeLaLista = async (org: Org, access: Access) =>
    (await runWithOrganization(org.id, () => listConversations(access))).reduce((a, c) => a + c.unreadCount, 0);
  const delEndpoint = (org: Org, access: Access) => runWithOrganization(org.id, () => countUnread(access));

  it("Propietario: igual que la lista (archivados dentro; campaña sin respuesta y Laboratorio fuera)", async () => {
    const lista = await sumaDeLaLista(A, ownerA());
    // 3 + 2 + 5 + 7 + 4 + 6 + 13 (respondió a campaña); NO 11 (pendiente) ni 17 (prueba).
    expect(lista).toBe(40);
    expect(await delEndpoint(A, ownerA())).toBe(lista);
  });

  it("Asesor: solo lo suyo (asignado o participante), igual que la lista", async () => {
    const lista = await sumaDeLaLista(A, asesorA());
    expect(lista).toBe(2 + 5 + 6);
    expect(await delEndpoint(A, asesorA())).toBe(lista);
  });

  it("Asesor sin chats a la vista: cero, igual que la lista", async () => {
    const ajeno: Access = { organizationId: A.id, userId: newId("user"), seesAll: false };
    expect(await sumaDeLaLista(A, ajeno)).toBe(0);
    expect(await delEndpoint(A, ajeno)).toBe(0);
  });

  it("otro asesor de la misma organización: igual que su lista", async () => {
    const lista = await sumaDeLaLista(A, otroA());
    expect(lista).toBe(4 + 6);
    expect(await delEndpoint(A, otroA())).toBe(lista);
  });

  it("otra organización: no se mezcla", async () => {
    const accessB: Access = { organizationId: B.id, userId: owner, seesAll: true };
    expect(await sumaDeLaLista(B, accessB)).toBe(19);
    expect(await delEndpoint(B, accessB)).toBe(19);
  });

  it("falla si difieren: marcar un chat como leído baja ambos por igual", async () => {
    await runWithOrganization(A.id, async () => {
      await getDb()
        .update(schema.conversation)
        .set({ unreadCount: 0 })
        .where(eq(schema.conversation.organizationId, A.id));
    });
    expect(await sumaDeLaLista(A, ownerA())).toBe(0);
    expect(await delEndpoint(A, ownerA())).toBe(0);
  });
});
