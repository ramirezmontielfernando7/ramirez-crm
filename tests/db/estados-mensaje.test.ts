import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getSystemDb as getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { processMessagesValue } from "@/server/inbox/ingest";
import { getCampaign, listRecipients } from "@/server/campaigns/service";
import type { WebhookStatus, WebhookValue } from "@/server/inbox/webhook";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Campañas v2, PR 1 — Estados del mensaje contra Postgres real: monotonía
 * (un failed tardío no pisa un delivered), horas por estado aunque lleguen
 * fuera de orden, el objeto pricing, y dos webhooks simultáneos.
 */

function estados(phoneNumberId: string, statuses: WebhookStatus[]): WebhookValue {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "5215500000000", phone_number_id: phoneNumberId },
    statuses,
  } as WebhookValue;
}

const T = (s: number) => String(1_790_000_000 + s);

describe("estados del mensaje (Campañas v2)", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let conversationId: string;

  beforeAll(async () => {
    A = await crearOrganizacion("Estados");
    const db = getDb();
    const contactId = newId("contact");
    await db.insert(schema.contact).values({
      id: contactId,
      organizationId: A.id,
      waIdentity: "5215512340000",
      phone: "5215512340000",
      name: "Cliente",
    });
    conversationId = newId("conversation");
    await db.insert(schema.conversation).values({ id: conversationId, organizationId: A.id, contactId });
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
  });

  async function saliente(): Promise<string> {
    const wamid = `wamid.estado.${Math.random().toString(36).slice(2)}`;
    await getDb().insert(schema.message).values({
      id: newId("message"),
      organizationId: A.id,
      conversationId,
      waMessageId: wamid,
      direction: "out",
      status: "pending",
    });
    return wamid;
  }

  async function leer(wamid: string) {
    const [m] = await getDb().select().from(schema.message).where(eq(schema.message.waMessageId, wamid));
    return m!;
  }

  it("sent con pricing → guarda hora y precios tal cual", async () => {
    const w = await saliente();
    await processMessagesValue(
      estados(A.phoneNumberId, [
        {
          id: w,
          status: "sent",
          timestamp: T(1),
          pricing: { billable: true, pricing_model: "PMP", category: "marketing", type: "regular" },
        },
      ])
    );
    const m = await leer(w);
    expect(m.status).toBe("sent");
    expect(m.sentAt?.getTime()).toBe(Number(T(1)) * 1000);
    expect(m.pricingBillable).toBe(true);
    expect(m.pricingCategory).toBe("marketing");
    expect(m.pricingModel).toBe("PMP");
    expect(m.pricingType).toBe("regular");
  });

  it("un failed tardío NO pisa un delivered (ni deja error)", async () => {
    const w = await saliente();
    await processMessagesValue(
      estados(A.phoneNumberId, [
        { id: w, status: "sent", timestamp: T(1) },
        { id: w, status: "delivered", timestamp: T(2) },
        { id: w, status: "failed", timestamp: T(3), errors: [{ code: 131049, title: "x" }] },
      ])
    );
    const m = await leer(w);
    expect(m.status).toBe("delivered");
    expect(m.failedAt).toBeNull();
    expect(m.error).toBeNull();
    expect(m.errorCode).toBeNull();
  });

  it("failed desde sent guarda código y traducción", async () => {
    const w = await saliente();
    await processMessagesValue(
      estados(A.phoneNumberId, [
        { id: w, status: "sent", timestamp: T(1) },
        { id: w, status: "failed", timestamp: T(4), errors: [{ code: 131049, title: "healthy ecosystem" }] },
      ])
    );
    const m = await leer(w);
    expect(m.status).toBe("failed");
    expect(m.errorCode).toBe(131049);
    expect(m.error).toMatch(/marketing/i);
    expect(m.failedAt?.getTime()).toBe(Number(T(4)) * 1000);
  });

  it("fuera de orden: read antes que delivered → queda read y ambas horas", async () => {
    const w = await saliente();
    await processMessagesValue(estados(A.phoneNumberId, [{ id: w, status: "read", timestamp: T(9) }]));
    await processMessagesValue(estados(A.phoneNumberId, [{ id: w, status: "delivered", timestamp: T(8) }]));
    await processMessagesValue(estados(A.phoneNumberId, [{ id: w, status: "sent", timestamp: T(7) }]));
    const m = await leer(w);
    expect(m.status).toBe("read");
    expect(m.readAt?.getTime()).toBe(Number(T(9)) * 1000);
    expect(m.deliveredAt?.getTime()).toBe(Number(T(8)) * 1000);
    expect(m.sentAt?.getTime()).toBe(Number(T(7)) * 1000);
  });

  it("la hora de cada estado se guarda una sola vez (el reintento de Meta no la mueve)", async () => {
    const w = await saliente();
    await processMessagesValue(estados(A.phoneNumberId, [{ id: w, status: "delivered", timestamp: T(2) }]));
    await processMessagesValue(estados(A.phoneNumberId, [{ id: w, status: "delivered", timestamp: T(50) }]));
    expect((await leer(w)).deliveredAt?.getTime()).toBe(Number(T(2)) * 1000);
  });

  it("dos webhooks simultáneos (read y failed) nunca terminan en failed", async () => {
    for (let i = 0; i < 10; i++) {
      const w = await saliente();
      await processMessagesValue(estados(A.phoneNumberId, [{ id: w, status: "sent", timestamp: T(1) }]));
      await Promise.all([
        processMessagesValue(estados(A.phoneNumberId, [{ id: w, status: "read", timestamp: T(3) }])),
        processMessagesValue(
          estados(A.phoneNumberId, [{ id: w, status: "delivered", timestamp: T(2) }])
        ),
      ]);
      await processMessagesValue(
        estados(A.phoneNumberId, [{ id: w, status: "failed", timestamp: T(4), errors: [{ code: 131026 }] }])
      );
      expect((await leer(w)).status).toBe("read");
    }
  });

  it("campaign_recipient refleja el estado real del mensaje (derivado, sin copiarlo)", async () => {
    const db = getDb();
    const w = await saliente();
    const [m] = await db.select().from(schema.message).where(eq(schema.message.waMessageId, w));
    const templateId = newId("template");
    await db.insert(schema.template).values({
      id: templateId, organizationId: A.id, name: `t_${templateId}`, language: "es_MX",
      category: "MARKETING", body: "Hola", status: "approved",
    });
    const campaignId = newId("campaign");
    await db.insert(schema.campaign).values({
      id: campaignId, organizationId: A.id, templateId, name: "C", status: "completed", total: 1,
    });
    await db.insert(schema.campaignRecipient).values({
      id: newId("campaignRecipient"), organizationId: A.id, campaignId, contactName: "Cliente",
      status: "sent", messageId: m!.id,
    });
    await processMessagesValue(
      estados(A.phoneNumberId, [
        { id: w, status: "sent", timestamp: T(1) },
        { id: w, status: "read", timestamp: T(5) },
      ])
    );
    const c = await runWithOrganization(A.id, () => getCampaign(A.id, campaignId));
    expect(c.delivery).toEqual({ delivered: 1, read: 1, failed: 0 });
    const [r] = await runWithOrganization(A.id, () => listRecipients(A.id, campaignId));
    expect(r!.delivery?.status).toBe("read");
    expect(r!.delivery?.readAt).toBe(new Date(Number(T(5)) * 1000).toISOString());
  });
});
