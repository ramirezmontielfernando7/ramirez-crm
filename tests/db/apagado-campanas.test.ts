import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { forgetOrgModules } from "@/server/modules/store";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { dispatchNumber, type SendFn } from "@/server/campaigns/dispatcher";
import { claimNext, finishClaim } from "@/server/campaigns/queue";
import { resetShutdownForTests, shutdown } from "@/server/shutdown";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Operación 1 (spec 043, apagado.md) — La cola de campañas ante un apagado,
 * contra Postgres real:
 *
 * - Apagado limpio: el despachador termina SOLO el envío en curso, no reclama
 *   a nadie más, no deja nada `sending` y suelta la concesión; el contenedor
 *   nuevo sigue sin duplicar ni perder a nadie.
 * - Corte brusco: un reclamo abandonado que todavía era «joven» cuando
 *   arrancó el despachador se recupera MIENTRAS espera (antes quedaba
 *   `sending` para siempre y la campaña nunca terminaba).
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("campañas y apagado", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let templateId: string;

  beforeAll(async () => {
    A = await crearOrganizacion("Apagado A");
    await getSystemDb()
      .insert(schema.organizationModule)
      .values({ organizationId: A.id, campaigns: true, campaignSendRate: 80 })
      .onConflictDoUpdate({ target: schema.organizationModule.organizationId, set: { campaigns: true, campaignSendRate: 80 } });
    forgetOrgModules(A.id);
    templateId = newId("template");
    await runWithOrganization(A.id, () =>
      getDb().insert(schema.template).values({
        id: templateId,
        organizationId: A.id,
        name: "promo",
        language: "es_MX",
        category: "MARKETING",
        body: "Hola {{1}}",
        status: "approved",
      })
    );
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
  });
  afterEach(async () => {
    resetShutdownForTests();
    await runWithOrganization(A.id, async () => {
      await getDb().delete(schema.waSendLease).where(eq(schema.waSendLease.organizationId, A.id));
      await getDb()
        .update(schema.campaign)
        .set({ status: "completed" })
        .where(and(eq(schema.campaign.organizationId, A.id), eq(schema.campaign.status, "sending")));
    });
  });

  async function campaignWith(n: number): Promise<string> {
    return runWithOrganization(A.id, async () => {
      const db = getDb();
      const campaignId = newId("campaign");
      await db.insert(schema.campaign).values({
        id: campaignId,
        organizationId: A.id,
        templateId,
        name: `apagado ${campaignId}`,
        status: "sending",
        phoneNumberId: A.phoneNumberId,
        startedAt: new Date(),
        total: n,
      });
      for (let i = 0; i < n; i++) {
        const phone = `52463${Math.floor(1e7 + Math.random() * 9e7)}`;
        const id = newId("contact");
        await db.insert(schema.contact).values({ id, organizationId: A.id, waIdentity: phone, phone, name: `C${i}`, waConsent: "opt_in" });
        await db.insert(schema.campaignRecipient).values({
          id: newId("campaignRecipient"),
          organizationId: A.id,
          campaignId,
          contactId: id,
          contactName: `C${i}`,
          phone,
          variables: [`C${i}`],
        });
      }
      return campaignId;
    });
  }

  /** Envío falso: mensaje con wamid en la BD y reclamo cerrado. `onSend` corre a media llamada. */
  function fakeSend(calls: string[], onSend?: (n: number) => Promise<void>): SendFn {
    return async (org, _c, r, owner) => {
      calls.push(r.id);
      await onSend?.(calls.length);
      await sleep(2);
      const conv = await getOrCreateConversation(org, r.contactId!);
      const [m] = await getDb()
        .insert(schema.message)
        .values({
          id: newId("message"),
          organizationId: org,
          conversationId: conv.id,
          waMessageId: `wamid.apagado.${r.id}`,
          direction: "out",
          type: "template",
          text: "x",
          status: "pending",
          origin: "template",
        })
        .returning();
      await finishClaim(org, r, { status: "sent", messageId: m!.id }, owner);
      return { kind: "sent" };
    };
  }

  async function statuses(campaignId: string) {
    const rows = await runWithOrganization(A.id, () =>
      getDb()
        .select({ status: schema.campaignRecipient.status, n: sql<number>`count(*)::int` })
        .from(schema.campaignRecipient)
        .where(and(eq(schema.campaignRecipient.organizationId, A.id), eq(schema.campaignRecipient.campaignId, campaignId)))
        .groupBy(schema.campaignRecipient.status)
    );
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }

  it("apagado limpio: termina el envío en curso, no reclama más y suelta la concesión; el nuevo sigue sin duplicar", async () => {
    const campaignId = await campaignWith(12);
    const calls: string[] = [];
    // SIGTERM llega A MEDIA llamada del 3.er envío (la que esperaba a Meta).
    const onSend = async (n: number) => {
      if (n === 3) await shutdown("SIGTERM", { exit: () => {}, closePools: async () => {}, graceMs: 1_000, minDrainMs: 0 });
    };
    const viejo = await runWithOrganization(A.id, () =>
      dispatchNumber(A.id, A.phoneNumberId, { owner: "contenedor-viejo", send: fakeSend(calls, onSend) })
    );
    expect(viejo).toEqual({ sends: 3, lease: true });
    expect(await statuses(campaignId)).toEqual({ sent: 3, pending: 9 });
    const leases = await runWithOrganization(A.id, () =>
      getDb().select().from(schema.waSendLease).where(eq(schema.waSendLease.organizationId, A.id))
    );
    expect(leases).toEqual([]);

    // El contenedor nuevo toma la concesión DE INMEDIATO (no espera a que venza) y termina.
    resetShutdownForTests();
    const nuevo = await runWithOrganization(A.id, () =>
      dispatchNumber(A.id, A.phoneNumberId, { owner: "contenedor-nuevo", send: fakeSend(calls) })
    );
    expect(nuevo).toEqual({ sends: 9, lease: true });
    expect(calls.length).toBe(12);
    expect(new Set(calls).size).toBe(12);
    expect(await statuses(campaignId)).toEqual({ sent: 12 });
  });

  it("corte brusco: el reclamo abandonado se recupera mientras el despachador espera y la campaña termina", { timeout: 20_000 }, async () => {
    const campaignId = await campaignWith(3);
    // Un contenedor que murió con un reclamo hecho hace 118 s: cuando arranca
    // el nuevo todavía no es «abandonado» (2 min); lo será en ~2 s.
    const muerto = await runWithOrganization(A.id, async () => {
      const r = await claimNext(A.id, campaignId, "contenedor-muerto");
      await getDb()
        .update(schema.campaignRecipient)
        .set({ claimedAt: sql`now() - interval '118 seconds'` })
        .where(and(eq(schema.campaignRecipient.organizationId, A.id), eq(schema.campaignRecipient.id, r!.id)));
      return r!;
    });
    const calls: string[] = [];
    const res = await runWithOrganization(A.id, () =>
      dispatchNumber(A.id, A.phoneNumberId, { owner: "contenedor-nuevo", send: fakeSend(calls), recoverEveryMs: 200 })
    );
    expect(res.sends).toBe(3);
    expect(calls).toContain(muerto.id);
    expect(new Set(calls).size).toBe(3);
    expect(await statuses(campaignId)).toEqual({ sent: 3 });
    const [c] = await runWithOrganization(A.id, () =>
      getDb().select().from(schema.campaign).where(and(eq(schema.campaign.organizationId, A.id), eq(schema.campaign.id, campaignId)))
    );
    expect(c?.status).toBe("completed");
  });
});
