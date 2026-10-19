import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import type { Access } from "@/lib/db/tenant";
import { forgetOrgModules } from "@/server/modules/store";
import { processMessagesValue } from "@/server/inbox/ingest";
import { countCampaignPending, listConversations } from "@/server/inbox/queries";
import { sendRecipient } from "@/server/campaigns/dispatcher";
import { claimNext } from "@/server/campaigns/queue";
import { subscribe, type SseEvent } from "@/server/events/bus";
import type { WebhookStatus, WebhookValue } from "@/server/inbox/webhook";
import { applyReclassify, planReclassify } from "../../scripts/lib/reclasificar-campanas-core.mjs";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 041 — Chats de campaña fuera de la Bandeja principal, contra Postgres real:
 *
 * - El envío de una campaña deja en «Campañas» SOLO los chats cuyo contacto
 *   nunca escribió; una conversación con entrantes previos sigue en la
 *   principal (y su envío sí avisa en vivo).
 * - Los envíos a chats pendientes y TODOS los ticks de estado de la campaña
 *   no publican eventos; la BD sí guarda cada estado.
 * - El primer entrante regresa el chat a la principal con «Respondió a
 *   campaña X», con no leídos y avisos como cualquier chat.
 * - Un asesor solo cuenta lo suyo; otra organización no ve nada.
 * - El script de reclasificación: clasifica bien y correrlo dos veces cambia 0.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;

const phone = () => `5255${Math.floor(1e7 + Math.random() * 9e7)}`;

function entrante(phoneNumberId: string, from: string, body: string): WebhookValue {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "5215500000000", phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: `Cliente ${from}` }, wa_id: from }],
    messages: [
      {
        from,
        id: `wamid.in.${Math.random().toString(36).slice(2)}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body },
      },
    ],
  } as WebhookValue;
}

function estados(phoneNumberId: string, statuses: WebhookStatus[]): WebhookValue {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "5215500000000", phone_number_id: phoneNumberId },
    statuses,
  } as WebhookValue;
}

describe("bandeja: chats de campaña (041)", () => {
  let A: Org;
  let B: Org;
  let templateId: string;
  const owner = newId("user");
  const asesor = newId("user");
  const events: SseEvent[] = [];
  let unsubscribe: () => void = () => {};

  const ownerA = (): Access => ({ organizationId: A.id, userId: owner, seesAll: true });
  const asesorA = (): Access => ({ organizationId: A.id, userId: asesor, seesAll: false });
  const inA = <T>(fn: () => Promise<T>) => runWithOrganization(A.id, fn);

  beforeAll(async () => {
    A = await crearOrganizacion("Bandeja campañas A");
    B = await crearOrganizacion("Bandeja campañas B");
    const sys = getSystemDb();
    await sys
      .insert(schema.organizationModule)
      .values({ organizationId: A.id, campaigns: true })
      .onConflictDoUpdate({ target: schema.organizationModule.organizationId, set: { campaigns: true } });
    forgetOrgModules(A.id);
    for (const id of [owner, asesor]) {
      await sys.insert(schema.user).values({ id, name: id, email: `${id}@x.test`, emailVerified: true });
    }
    templateId = newId("template");
    await inA(() =>
      getDb().insert(schema.template).values({
        id: templateId,
        organizationId: A.id,
        name: "promo",
        language: "es_MX",
        // Utilidad: la regla de frecuencia de marketing no omite la 2.ª campaña.
        category: "UTILITY",
        body: "Hola {{1}}",
        status: "approved",
      })
    );
    unsubscribe = subscribe(A.id, (e) => events.push(e));
  });

  afterAll(async () => {
    unsubscribe();
    await borrarOrganizaciones([A.id, B.id]);
    const sys = getSystemDb();
    for (const id of [owner, asesor]) await sys.delete(schema.user).where(eq(schema.user.id, id));
  });

  /** Meta falso: responde como la Graph API con un wamid nuevo. */
  const wamids: string[] = [];
  function stubMeta() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const id = `wamid.out.${newId("message")}`;
        wamids.push(id);
        return new Response(JSON.stringify({ messages: [{ id }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );
  }
  afterEach(() => vi.unstubAllGlobals());

  async function contacto(name: string, opts: { assignedTo?: string } = {}) {
    const p = phone();
    const id = newId("contact");
    await inA(() =>
      getDb().insert(schema.contact).values({
        id,
        organizationId: A.id,
        waIdentity: p,
        phone: p,
        name,
        waConsent: "opt_in",
        assignedUserId: opts.assignedTo ?? null,
      })
    );
    return { id, phone: p };
  }

  /** Una campaña `sending` con un destinatario por contacto, enviada de verdad (`sendRecipient`). */
  async function enviarCampana(name: string, contactIds: string[]) {
    return inA(async () => {
      const db = getDb();
      const campaignId = newId("campaign");
      await db.insert(schema.campaign).values({
        id: campaignId,
        organizationId: A.id,
        templateId,
        name,
        status: "sending",
        phoneNumberId: A.phoneNumberId,
        startedAt: new Date(),
        total: contactIds.length,
      });
      for (const contactId of contactIds) {
        await db.insert(schema.campaignRecipient).values({
          id: newId("campaignRecipient"),
          organizationId: A.id,
          campaignId,
          contactId,
          contactName: "x",
          variables: ["x"],
        });
      }
      const [campaign] = await db
        .select()
        .from(schema.campaign)
        .where(and(eq(schema.campaign.organizationId, A.id), eq(schema.campaign.id, campaignId)));
      for (;;) {
        const r = await claimNext(A.id, campaignId, "prueba");
        if (!r) break;
        const res = await sendRecipient(A.id, campaign!, r, "prueba");
        expect(res.kind).toBe("sent");
      }
      return campaignId;
    });
  }

  async function conversacionDe(contactId: string) {
    return inA(async () => {
      const [c] = await getDb()
        .select()
        .from(schema.conversation)
        .where(and(eq(schema.conversation.organizationId, A.id), eq(schema.conversation.contactId, contactId)));
      return c!;
    });
  }

  let nuevo: { id: string; phone: string };
  let activo: { id: string; phone: string };
  let soloSaliente: { id: string; phone: string };
  let campaignId: string;

  it("el envío deja en «Campañas» solo a quien nunca escribió; el chat activo sigue en la principal", async () => {
    nuevo = await contacto("Nuevo", { assignedTo: asesor });
    activo = await contacto("Activo");
    soloSaliente = await contacto("SoloSaliente");
    // Activo ya había escrito: conversación con entrantes previos.
    await processMessagesValue(entrante(A.phoneNumberId, activo.phone, "hola, ¿tienen envíos?"));
    // SoloSaliente tiene chat, pero solo con mensajes del negocio.
    await inA(() =>
      getDb().insert(schema.conversation).values({ id: newId("conversation"), organizationId: A.id, contactId: soloSaliente.id })
    );
    const activoConv = await conversacionDe(activo.id);

    stubMeta();
    events.length = 0;
    campaignId = await enviarCampana("Buen Fin", [nuevo.id, activo.id, soloSaliente.id]);

    expect((await conversacionDe(nuevo.id)).campaignPendingId).toBe(campaignId);
    expect((await conversacionDe(soloSaliente.id)).campaignPendingId).toBe(campaignId);
    expect((await conversacionDe(activo.id)).campaignPendingId).toBeNull();

    // Solo el chat activo avisó en vivo (un message.new); los pendientes, nada.
    expect(events.map((e) => e.type)).toEqual(["message.new"]);
    expect(events[0]!.type === "message.new" && events[0]!.data.conversationId).toBe(activoConv.id);
  });

  it("la Bandeja principal no los trae; «Campañas» sí, con su campaña; no cuentan como no leídos", async () => {
    const main = await inA(() => listConversations(ownerA()));
    const ids = main.map((c) => c.contact.id);
    expect(ids).toContain(activo.id);
    expect(ids).not.toContain(nuevo.id);
    expect(ids).not.toContain(soloSaliente.id);

    const camp = await inA(() => listConversations(ownerA(), undefined, { kind: "all" }, "campaigns"));
    expect(camp.map((c) => c.contact.id).sort()).toEqual([nuevo.id, soloSaliente.id].sort());
    for (const c of camp) {
      expect(c.campaign).toEqual({ state: "pending", name: "Buen Fin" });
      expect(c.unreadCount).toBe(0);
    }
    expect(await inA(() => countCampaignPending(ownerA()))).toBe(2);
    // El total de no leídos de la principal no incluye nada de la campaña.
    expect(main.reduce((a, c) => a + c.unreadCount, 0)).toBe(
      main.find((c) => c.contact.id === activo.id)!.unreadCount
    );
  });

  it("un asesor solo cuenta lo suyo; otra organización no ve nada", async () => {
    expect(await inA(() => countCampaignPending(asesorA()))).toBe(1);
    const camp = await inA(() => listConversations(asesorA(), undefined, { kind: "all" }, "campaigns"));
    expect(camp.map((c) => c.contact.id)).toEqual([nuevo.id]);
    const otra: Access = { organizationId: B.id, userId: owner, seesAll: true };
    expect(await runWithOrganization(B.id, () => countCampaignPending(otra))).toBe(0);
  });

  it("los ticks de estado del envío masivo NO publican eventos, pero la BD guarda cada uno", async () => {
    expect(wamids).toHaveLength(3);
    events.length = 0;
    const t = Math.floor(Date.now() / 1000);
    for (const [i, status] of (["sent", "delivered", "read"] as const).entries()) {
      await processMessagesValue(
        estados(A.phoneNumberId, wamids.map((id) => ({ id, status, timestamp: String(t + i) })))
      );
    }
    expect(events.map((e) => e.type)).toEqual([]);
    const rows = await inA(() =>
      getDb()
        .select({ status: schema.message.status, sentAt: schema.message.sentAt, readAt: schema.message.readAt })
        .from(schema.message)
        .where(and(eq(schema.message.organizationId, A.id), eq(schema.message.origin, "template")))
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.status).toBe("read");
      expect(r.sentAt).not.toBeNull();
      expect(r.readAt).not.toBeNull();
    }
  });

  it("un mensaje que NO es de campaña sigue avisando su estado", async () => {
    const conv = await conversacionDe(activo.id);
    const wamid = `wamid.manual.${newId("message")}`;
    await inA(() =>
      getDb().insert(schema.message).values({
        id: newId("message"),
        organizationId: A.id,
        conversationId: conv.id,
        waMessageId: wamid,
        direction: "out",
        status: "pending",
      })
    );
    events.length = 0;
    await processMessagesValue(estados(A.phoneNumberId, [{ id: wamid, status: "delivered", timestamp: String(Math.floor(Date.now() / 1000)) }]));
    expect(events.map((e) => e.type)).toEqual(["message.status"]);
  });

  it("al responder, el chat pasa a la principal con «Respondió a campaña X», no leídos y avisos normales", async () => {
    events.length = 0;
    await processMessagesValue(entrante(A.phoneNumberId, nuevo.phone, "me interesa"));
    const conv = await conversacionDe(nuevo.id);
    expect(conv.campaignPendingId).toBeNull();
    expect(conv.campaignRepliedId).toBe(campaignId);
    expect(conv.unreadCount).toBe(1);
    expect(events.map((e) => e.type)).toEqual(["message.new", "conversation.updated"]);

    const main = await inA(() => listConversations(ownerA()));
    const row = main.find((c) => c.contact.id === nuevo.id);
    expect(row?.campaign).toEqual({ state: "replied", name: "Buen Fin" });
    expect(row?.unreadCount).toBe(1);
    expect(await inA(() => countCampaignPending(ownerA()))).toBe(1);
  });

  it("una segunda campaña no vuelve a esconder a quien ya respondió; a un pendiente le deja la más reciente", async () => {
    stubMeta();
    const segunda = await enviarCampana("Navidad", [nuevo.id, soloSaliente.id]);
    expect((await conversacionDe(nuevo.id)).campaignPendingId).toBeNull();
    expect((await conversacionDe(soloSaliente.id)).campaignPendingId).toBe(segunda);
  });

  it("reclasificación de chats viejos: clasifica bien y correrla dos veces cambia 0", async () => {
    // Datos «de antes de la 0051»: mensajes de campaña sin ninguna marca.
    const viejo = await contacto("ViejoSinRespuesta");
    const respondio = await contacto("ViejoRespondio");
    const yaEscribia = await contacto("ViejoActivo");
    const legacyCampaign = newId("campaign");
    const t0 = new Date(Date.now() - 3 * 86_400_000);
    const at = (h: number) => new Date(t0.getTime() + h * 3_600_000);
    await inA(async () => {
      const db = getDb();
      await db.insert(schema.campaign).values({
        id: legacyCampaign,
        organizationId: A.id,
        templateId,
        name: "Vieja",
        status: "completed",
        phoneNumberId: A.phoneNumberId,
        total: 3,
      });
      for (const [c, inboundBefore, inboundAfter] of [
        [viejo, false, false],
        [respondio, false, true],
        [yaEscribia, true, false],
      ] as const) {
        const convId = newId("conversation");
        await db.insert(schema.conversation).values({
          id: convId,
          organizationId: A.id,
          contactId: c.id,
          lastInboundAt: inboundBefore || inboundAfter ? at(inboundBefore ? 0 : 2) : null,
        });
        if (inboundBefore) {
          await db.insert(schema.message).values({ id: newId("message"), organizationId: A.id, conversationId: convId, direction: "in", status: "delivered", waTimestamp: at(0) });
        }
        const msgId = newId("message");
        await db.insert(schema.message).values({ id: msgId, organizationId: A.id, conversationId: convId, direction: "out", type: "template", origin: "template", status: "read", waTimestamp: at(1) });
        await db.insert(schema.campaignRecipient).values({ id: newId("campaignRecipient"), organizationId: A.id, campaignId: legacyCampaign, contactId: c.id, contactName: "x", status: "sent", messageId: msgId });
        if (inboundAfter) {
          await db.insert(schema.message).values({ id: newId("message"), organizationId: A.id, conversationId: convId, direction: "in", status: "delivered", waTimestamp: at(2) });
        }
      }
    });

    // Con la conexión de la app (RLS) y la organización fijada, como el script.
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    const enA = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
      sql.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${A.id}, true)`;
        return fn(tx);
      }) as Promise<T>;
    try {
      const plan = await enA((tx) => planReclassify(tx, A.id));
      const ids = async (c: { id: string }) => (await conversacionDe(c.id)).id;
      expect(plan.pending.map((p) => p.id)).toEqual([await ids(viejo)]);
      expect(plan.pending[0]!.campaignId).toBe(legacyCampaign);
      expect(plan.replied.map((p) => p.id)).toEqual([await ids(respondio)]);
      // Los chats de arriba ya tienen marca: no entran; el activo cuenta como «sin tocar».
      expect(plan.active).toBe(2); // ViejoActivo + Activo (escribía antes de «Buen Fin»)

      expect(await enA((tx) => applyReclassify(tx, A.id, plan))).toEqual({ pending: 1, replied: 1 });
      expect((await conversacionDe(viejo.id)).campaignPendingId).toBe(legacyCampaign);
      expect((await conversacionDe(respondio.id)).campaignRepliedId).toBe(legacyCampaign);
      expect((await conversacionDe(yaEscribia.id)).campaignPendingId).toBeNull();
      expect((await conversacionDe(yaEscribia.id)).campaignRepliedId).toBeNull();

      // Segunda vuelta: nada que hacer, y aplicar el MISMO plan otra vez tampoco cambia nada.
      const otra = await enA((tx) => planReclassify(tx, A.id));
      expect(otra.pending).toEqual([]);
      expect(otra.replied).toEqual([]);
      expect(await enA((tx) => applyReclassify(tx, A.id, plan))).toEqual({ pending: 0, replied: 0 });
    } finally {
      await sql.end();
    }
  });
});
