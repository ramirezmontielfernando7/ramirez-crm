import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import type { Access } from "@/lib/db/tenant";
import { listConversations } from "@/server/inbox/queries";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Paso 2 (PR 2) — Refrescar SOLO los chats que un aviso en vivo cambió
 * (`listConversations(…, { ids | contactIds })`), contra Postgres real y como
 * la app:
 *
 * - La fila refrescada es IDÉNTICA a la que trae la lista completa (lead,
 *   etapa y color, etiquetas, vista previa, anuncio, asignado, campaña…).
 * - Lo que la sesión ya no ve en esa vista NO vuelve: eliminado, de otro
 *   asesor, de otra organización, o pendiente en «Campañas» (que sí vuelve
 *   en su vista). El archivado vuelve, con su `archivedAt`: la principal
 *   también lo trae.
 * - Pedir «ninguno» no es pedir «todos».
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;

describe("bandeja: refresco por chat = fila de la lista completa", () => {
  let A: Org;
  let B: Org;
  const owner = newId("user");
  const asesor = newId("user");
  const otro = newId("user");
  const ownerA = (): Access => ({ organizationId: A.id, userId: owner, seesAll: true });
  const asesorA = (): Access => ({ organizationId: A.id, userId: asesor, seesAll: false });
  const ownerB = (): Access => ({ organizationId: B.id, userId: owner, seesAll: true });
  const chats: Record<string, { conversationId: string; contactId: string }> = {};

  async function chat(
    org: Org,
    clave: string,
    opts: {
      assignedTo?: string;
      participant?: string;
      archived?: boolean;
      campaignPending?: boolean;
      campaignReplied?: boolean;
      lead?: boolean;
      tags?: boolean;
      anuncio?: boolean;
      mensajes?: number;
      minutosAtras?: number;
    } = {}
  ) {
    const contactId = newId("contact");
    const conversationId = newId("conversation");
    const tel = `5255${Math.floor(1e7 + Math.random() * 9e7)}`;
    const cuando = new Date(Date.now() - (opts.minutosAtras ?? 1) * 60_000);
    await runWithOrganization(org.id, async () => {
      const db = getDb();
      await db.insert(schema.contact).values({
        id: contactId,
        organizationId: org.id,
        waIdentity: tel,
        phone: tel,
        name: `Cliente ${clave}`,
        assignedUserId: opts.assignedTo ?? null,
      });
      await db.insert(schema.conversation).values({
        id: conversationId,
        organizationId: org.id,
        contactId,
        unreadCount: 2,
        lastInboundAt: cuando,
        lastMessageAt: opts.mensajes === 0 ? null : cuando,
        archivedAt: opts.archived ? new Date() : null,
        campaignPendingId: opts.campaignPending ? "cmp_x" : null,
        campaignRepliedId: opts.campaignReplied ? "cmp_x" : null,
      });
      for (let i = 0; i < (opts.mensajes ?? 2); i++) {
        await db.insert(schema.message).values({
          id: newId("message"),
          organizationId: org.id,
          conversationId,
          direction: i % 2 ? "out" : "in",
          text: `Mensaje ${i} de ${clave}`,
          createdAt: new Date(cuando.getTime() - (10 - i) * 1000),
        });
      }
      if (opts.lead) {
        const [etapa] = await db
          .select({ id: schema.pipelineStage.id })
          .from(schema.pipelineStage)
          .where(and(eq(schema.pipelineStage.organizationId, org.id), eq(schema.pipelineStage.kind, "open")))
          .limit(1);
        await db.update(schema.pipelineStage).set({ color: "verde" }).where(and(eq(schema.pipelineStage.organizationId, org.id), eq(schema.pipelineStage.id, etapa!.id)));
        await db.insert(schema.lead).values({ id: newId("lead"), organizationId: org.id, contactId, stageId: etapa!.id });
      }
      if (opts.tags) {
        const tagId = newId("contactTag");
        await db.insert(schema.contactTag).values({ id: tagId, organizationId: org.id, name: `VIP ${clave}`, color: "azul" });
        await db.insert(schema.contactTagAssignment).values({ organizationId: org.id, contactId, tagId });
      }
      if (opts.anuncio) {
        await db.insert(schema.adAttribution).values({
          id: newId("adAttribution"),
          organizationId: org.id,
          contactId,
          conversationId,
          headline: "Promo de otoño",
          sourceId: "ad_1",
          sourceType: "ad",
          raw: {},
        });
      }
      if (opts.participant) {
        await db.insert(schema.contactParticipant).values({ organizationId: org.id, contactId, userId: opts.participant });
      }
    });
    chats[clave] = { conversationId, contactId };
  }

  beforeAll(async () => {
    A = await crearOrganizacion("Refresco A");
    B = await crearOrganizacion("Refresco B");
    const sys = getSystemDb();
    for (const id of [owner, asesor, otro]) {
      await sys.insert(schema.user).values({ id, name: `Persona ${id}`, email: `${id}@x.test`, emailVerified: true });
    }
    await chat(A, "completo", { lead: true, tags: true, anuncio: true, assignedTo: asesor, minutosAtras: 1 });
    await chat(A, "sin-lead", { minutosAtras: 2 });
    await chat(A, "sin-mensajes", { mensajes: 0, minutosAtras: 3 });
    await chat(A, "archivado", { archived: true, assignedTo: asesor, minutosAtras: 4 });
    await chat(A, "de-otro", { assignedTo: otro, lead: true, minutosAtras: 5 });
    await chat(A, "participante", { assignedTo: otro, participant: asesor, minutosAtras: 6 });
    await chat(A, "campana", { campaignPending: true, minutosAtras: 7 });
    await chat(A, "respondio", { campaignReplied: true, minutosAtras: 8 });
    await chat(A, "eliminado", { minutosAtras: 9 });
    await chat(B, "otra-empresa", { lead: true, minutosAtras: 1 });
    await runWithOrganization(A.id, () =>
      getDb()
        .delete(schema.conversation)
        .where(and(eq(schema.conversation.organizationId, A.id), eq(schema.conversation.id, chats["eliminado"]!.conversationId)))
    );
  });

  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
    const sys = getSystemDb();
    for (const id of [owner, asesor, otro]) await sys.delete(schema.user).where(eq(schema.user.id, id));
  });

  // `windowRemainingMs` sale de la hora: con el reloj quieto, las dos
  // consultas se comparan campo por campo, sin excepción.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const enA = <T>(fn: () => Promise<T>) => runWithOrganization(A.id, fn);
  const id = (clave: string) => chats[clave]!.conversationId;
  const contacto = (clave: string) => chats[clave]!.contactId;

  it("Propietario: cada fila pedida por id es idéntica a la de la lista completa", async () => {
    const lista = await enA(() => listConversations(ownerA()));
    expect(lista.length).toBe(7); // 9 menos el eliminado y el de «Campañas»
    for (const fila of lista) {
      const sola = await enA(() => listConversations(ownerA(), undefined, { kind: "all" }, "main", { ids: [fila.id] }));
      expect(sola).toEqual([fila]);
    }
    // Y la de todos los datos trae de verdad lo que la lista pinta.
    const completo = lista.find((c) => c.id === id("completo"))!;
    expect(completo.leadId).not.toBeNull();
    expect(completo.stageName).toBeTruthy();
    expect(completo.stageColor).toBe("verde");
    expect(completo.tags.map((t) => t.color)).toEqual(["azul"]);
    expect(completo.preview).toBe("Mensaje 1 de completo");
    expect(completo.anuncio?.headline).toBe("Promo de otoño");
    expect(completo.assignee?.id).toBe(asesor);
    const sinLead = lista.find((c) => c.id === id("sin-lead"))!;
    expect([sinLead.leadId, sinLead.stageId, sinLead.stageName, sinLead.stageColor]).toEqual([null, null, null, null]);
  });

  it("varios a la vez (ids y contactos) vienen en el mismo orden que la lista", async () => {
    const lista = await enA(() => listConversations(ownerA()));
    const pedidos = await enA(() =>
      listConversations(ownerA(), undefined, { kind: "all" }, "main", {
        ids: [id("respondio"), id("completo")],
        contactIds: [contacto("sin-mensajes")],
      })
    );
    expect(pedidos).toEqual(lista.filter((c) => [id("respondio"), id("completo"), id("sin-mensajes")].includes(c.id)));
  });

  it("por contacto es lo mismo que por conversación", async () => {
    const porId = await enA(() => listConversations(ownerA(), undefined, { kind: "all" }, "main", { ids: [id("de-otro")] }));
    const porContacto = await enA(() =>
      listConversations(ownerA(), undefined, { kind: "all" }, "main", { contactIds: [contacto("de-otro")] })
    );
    expect(porContacto).toEqual(porId);
    expect(porId).toHaveLength(1);
  });

  it("archivado: vuelve con su archivedAt (la principal también lo trae)", async () => {
    const [fila] = await enA(() => listConversations(ownerA(), undefined, { kind: "all" }, "main", { ids: [id("archivado")] }));
    expect(fila?.archivedAt).not.toBeNull();
  });

  it("eliminado: no vuelve", async () => {
    expect(await enA(() => listConversations(ownerA(), undefined, { kind: "all" }, "main", { ids: [id("eliminado")] }))).toEqual([]);
  });

  it("pendiente de campaña: no vuelve en la principal; en «Campañas» sí, igual que su lista", async () => {
    expect(await enA(() => listConversations(ownerA(), undefined, { kind: "all" }, "main", { ids: [id("campana")] }))).toEqual([]);
    const lista = await enA(() => listConversations(ownerA(), undefined, { kind: "all" }, "campaigns"));
    const sola = await enA(() => listConversations(ownerA(), undefined, { kind: "all" }, "campaigns", { ids: [id("campana")] }));
    expect(sola).toEqual(lista.filter((c) => c.id === id("campana")));
    expect(sola).toHaveLength(1);
  });

  it("asesor: lo suyo (asignado o participante) idéntico a su lista; lo de otro no vuelve", async () => {
    const lista = await enA(() => listConversations(asesorA()));
    expect(lista.map((c) => c.id).sort()).toEqual([id("completo"), id("archivado"), id("participante")].sort());
    for (const fila of lista) {
      expect(await enA(() => listConversations(asesorA(), undefined, { kind: "all" }, "main", { ids: [fila.id] }))).toEqual([fila]);
    }
    const ajenos = await enA(() =>
      listConversations(asesorA(), undefined, { kind: "all" }, "main", {
        ids: [id("de-otro"), id("sin-lead")],
        contactIds: [contacto("de-otro"), contacto("respondio")],
      })
    );
    expect(ajenos).toEqual([]);
  });

  it("el filtro de asignación de quien ve todo también se respeta", async () => {
    const mios = await enA(() =>
      listConversations(ownerA(), undefined, { kind: "user", userId: otro }, "main", { ids: [id("completo"), id("de-otro")] })
    );
    expect(mios.map((c) => c.id)).toEqual([id("de-otro")]);
  });

  it("otra organización: pedir ids ajenos no trae nada; lo suyo sí", async () => {
    const enB = <T>(fn: () => Promise<T>) => runWithOrganization(B.id, fn);
    const ajenos = await enB(() =>
      listConversations(ownerB(), undefined, { kind: "all" }, "main", {
        ids: Object.values(chats).map((c) => c.conversationId),
        contactIds: [contacto("completo")],
      })
    );
    expect(ajenos.map((c) => c.id)).toEqual([id("otra-empresa")]);
    // Con el contexto de A y la sesión de B tampoco se cruza nada.
    const cruzado = await enA(() => listConversations(ownerB(), undefined, { kind: "all" }, "main", { ids: [id("completo")] }));
    expect(cruzado).toEqual([]);
  });

  it("pedir «ninguno» no es pedir «todos»", async () => {
    expect(await enA(() => listConversations(ownerA(), undefined, { kind: "all" }, "main", { ids: [], contactIds: [] }))).toEqual([]);
  });
});
