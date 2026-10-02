import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { forgetOrgModules } from "@/server/modules/store";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { campaignSchedulerTick, dispatchNumber, type SendFn } from "@/server/campaigns/dispatcher";
import {
  acquireLease,
  claimNext,
  finishClaim,
  recoverAbandoned,
  renewLease,
} from "@/server/campaigns/queue";
import { cancelCampaign, pauseCampaign, resumeCampaign } from "@/server/campaigns/lifecycle";
import { launchCampaign, createCampaign } from "@/server/campaigns/service";
import { saveCampaignSettings, DEFAULT_CAMPAIGN_SETTINGS } from "@/server/campaigns/settings";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Campañas v2, PR 2 — La cola de envío POR NÚMERO contra Postgres real.
 *
 * - Dos despachadores (dos "contenedores") sobre el mismo número: cada
 *   destinatario se envía UNA vez, y solo uno despacha (concesión).
 * - Reclamo atómico: aun sin concesión (dos réplicas que se creen dueñas),
 *   dos reclamadores concurrentes nunca toman la misma fila.
 * - Recuperación tras un reinicio: sin mensaje → vuelve a la fila; con wamid
 *   → enviado; sin wamid → fallido sin reenvío; y un reclamo cuyo dueño sigue
 *   vivo NO se toca.
 * - Pausa de seguridad por tasa de fallos; pausar, reanudar y cancelar.
 * - Lanzar: solo opt_in, excluidos por motivo, variables desde columnas.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("cola de campañas por número", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let templateId: string;
  let userId: string;

  beforeAll(async () => {
    process.env.CAMPAIGN_BACKOFF_SCALE = "0.001";
    A = await crearOrganizacion("Cola A");
    await getSystemDb()
      .insert(schema.organizationModule)
      .values({ organizationId: A.id, campaigns: true, campaignSendRate: 80 })
      .onConflictDoUpdate({ target: schema.organizationModule.organizationId, set: { campaigns: true, campaignSendRate: 80 } });
    forgetOrgModules(A.id);
    templateId = newId("template");
    userId = newId("user");
    await getSystemDb().insert(schema.user).values({ id: userId, name: "Coordinadora", email: `${userId}@x.test`, emailVerified: true });
    await runWithOrganization(A.id, () =>
      getDb().insert(schema.template).values({
        id: templateId,
        organizationId: A.id,
        name: "promo",
        language: "es_MX",
        category: "MARKETING",
        body: "Hola {{1}}, tu cupón es {{2}}",
        status: "approved",
      })
    );
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, userId));
  });

  /** Contactos opt_in y una campaña `sending` con un destinatario por contacto. */
  async function campaignWith(n: number): Promise<{ campaignId: string; contactIds: string[] }> {
    return runWithOrganization(A.id, async () => {
      const db = getDb();
      const campaignId = newId("campaign");
      const contactIds: string[] = [];
      await db.insert(schema.campaign).values({
        id: campaignId,
        organizationId: A.id,
        templateId,
        name: `cola ${campaignId}`,
        status: "sending",
        phoneNumberId: A.phoneNumberId,
        startedAt: new Date(),
        total: n,
      });
      for (let i = 0; i < n; i++) {
        const phone = `52462${Math.floor(1e7 + Math.random() * 9e7)}`;
        const id = newId("contact");
        contactIds.push(id);
        await db.insert(schema.contact).values({ id, organizationId: A.id, waIdentity: phone, phone, name: `C${i}`, waConsent: "opt_in" });
        await db.insert(schema.campaignRecipient).values({
          id: newId("campaignRecipient"),
          organizationId: A.id,
          campaignId,
          contactId: id,
          contactName: `C${i}`,
          phone,
          variables: [`C${i}`, "X1"],
        });
      }
      return { campaignId, contactIds };
    });
  }

  /** Un "envío" falso: mensaje real en la BD (con wamid) y reclamo cerrado. */
  function fakeSend(calls: string[], delayMs = 3): SendFn {
    return async (org, _c, r, owner) => {
      calls.push(r.id);
      await sleep(delayMs);
      const conv = await getOrCreateConversation(org, r.contactId!);
      const [m] = await getDb()
        .insert(schema.message)
        .values({
          id: newId("message"),
          organizationId: org,
          conversationId: conv.id,
          waMessageId: `wamid.fake.${r.id}`,
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
    return runWithOrganization(A.id, () =>
      getDb()
        .select({ status: schema.campaignRecipient.status, n: sql<number>`count(*)::int` })
        .from(schema.campaignRecipient)
        .where(and(eq(schema.campaignRecipient.organizationId, A.id), eq(schema.campaignRecipient.campaignId, campaignId)))
        .groupBy(schema.campaignRecipient.status)
    ).then((rows) => Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])));
  }

  async function campaignRow(id: string) {
    const [c] = await runWithOrganization(A.id, () =>
      getDb().select().from(schema.campaign).where(and(eq(schema.campaign.organizationId, A.id), eq(schema.campaign.id, id)))
    );
    return c!;
  }

  beforeEach(async () => {
    // Ninguna concesión ni campaña activa de una prueba anterior.
    await runWithOrganization(A.id, async () => {
      await getDb().delete(schema.waSendLease).where(eq(schema.waSendLease.organizationId, A.id));
      await getDb()
        .update(schema.campaign)
        .set({ status: "completed" })
        .where(and(eq(schema.campaign.organizationId, A.id), eq(schema.campaign.status, "sending")));
    });
  });

  it("dos despachadores sobre el mismo número: cada destinatario sale UNA vez y solo uno despacha", async () => {
    const { campaignId } = await campaignWith(25);
    const calls: string[] = [];
    const [one, two] = await runWithOrganization(A.id, () =>
      Promise.all([
        dispatchNumber(A.id, A.phoneNumberId, { owner: "contenedor-1", send: fakeSend(calls) }),
        dispatchNumber(A.id, A.phoneNumberId, { owner: "contenedor-2", send: fakeSend(calls) }),
      ])
    );
    expect(calls.length).toBe(25);
    expect(new Set(calls).size).toBe(25);
    // Uno tuvo la concesión y el otro no despachó nada.
    expect([one.lease, two.lease].sort()).toEqual([false, true]);
    expect(await statuses(campaignId)).toEqual({ sent: 25 });
    expect((await campaignRow(campaignId)).status).toBe("completed");
  });

  it("reclamo atómico: dos reclamadores concurrentes sin concesión nunca toman la misma fila", async () => {
    const { campaignId } = await campaignWith(40);
    const taken: string[] = [];
    const claimer = async (owner: string) => {
      for (;;) {
        const r = await runWithOrganization(A.id, () => claimNext(A.id, campaignId, owner));
        if (!r) return;
        taken.push(r.id);
      }
    };
    await Promise.all([claimer("x"), claimer("y"), claimer("z")]);
    expect(taken.length).toBe(40);
    expect(new Set(taken).size).toBe(40);
  });

  it("concesión: la de un dueño vivo no se roba; una vencida sí", async () => {
    await runWithOrganization(A.id, async () => {
      expect(await acquireLease(A.id, "PN-L", "vivo")).toBe(true);
      expect(await acquireLease(A.id, "PN-L", "intruso")).toBe(false);
      expect(await renewLease(A.id, "PN-L", "vivo")).toBe(true);
      await getDb()
        .update(schema.waSendLease)
        .set({ heartbeatAt: sql`now() - interval '5 minutes'` })
        .where(and(eq(schema.waSendLease.organizationId, A.id), eq(schema.waSendLease.phoneNumberId, "PN-L")));
      expect(await acquireLease(A.id, "PN-L", "intruso")).toBe(true);
      expect(await renewLease(A.id, "PN-L", "vivo")).toBe(false);
    });
  });

  it("recuperación tras un reinicio: no reenvía lo incierto y no toca reclamos de un dueño vivo", async () => {
    const { campaignId } = await campaignWith(4);
    await runWithOrganization(A.id, async () => {
      const db = getDb();
      const [r1, r2, r3, r4] = [
        await claimNext(A.id, campaignId, "muerto"),
        await claimNext(A.id, campaignId, "muerto"),
        await claimNext(A.id, campaignId, "muerto"),
        await claimNext(A.id, campaignId, "vivo"),
      ];
      // r1: murió antes de reservar el mensaje (Meta nunca se llamó).
      // r2: reservó y Meta respondió (wamid guardado), murió antes de cerrar.
      // r3: reservó y murió esperando a Meta (sin wamid): incierto.
      const conv2 = await getOrCreateConversation(A.id, r2!.contactId!);
      const conv3 = await getOrCreateConversation(A.id, r3!.contactId!);
      const [m2] = await db
        .insert(schema.message)
        .values({ id: newId("message"), organizationId: A.id, conversationId: conv2.id, waMessageId: `wamid.r2.${r2!.id}`, direction: "out", type: "template", text: "x", status: "pending", origin: "template" })
        .returning();
      const [m3] = await db
        .insert(schema.message)
        .values({ id: newId("message"), organizationId: A.id, conversationId: conv3.id, waMessageId: null, direction: "out", type: "template", text: "x", status: "pending", origin: "template" })
        .returning();
      await db.update(schema.campaignRecipient).set({ messageId: m2!.id }).where(and(eq(schema.campaignRecipient.organizationId, A.id), eq(schema.campaignRecipient.id, r2!.id)));
      await db.update(schema.campaignRecipient).set({ messageId: m3!.id }).where(and(eq(schema.campaignRecipient.organizationId, A.id), eq(schema.campaignRecipient.id, r3!.id)));
      // Todos los reclamos son viejos; "vivo" tiene la concesión de un número y la renueva.
      await db
        .update(schema.campaignRecipient)
        .set({ claimedAt: sql`now() - interval '10 minutes'` })
        .where(and(eq(schema.campaignRecipient.organizationId, A.id), eq(schema.campaignRecipient.campaignId, campaignId)));
      expect(await acquireLease(A.id, "PN-OTRO", "vivo")).toBe(true);

      const rec = await recoverAbandoned(A.id);
      expect(rec).toEqual({ requeued: 1, sent: 1, failed: 1 });
      const rows = await db
        .select()
        .from(schema.campaignRecipient)
        .where(and(eq(schema.campaignRecipient.organizationId, A.id), eq(schema.campaignRecipient.campaignId, campaignId)));
      const by = new Map(rows.map((r) => [r.id, r]));
      expect(by.get(r1!.id)?.status).toBe("pending");
      expect(by.get(r2!.id)?.status).toBe("sent");
      expect(by.get(r3!.id)).toMatchObject({ status: "failed", errorMessage: expect.stringMatching(/no se reintentó/) });
      // El dueño vivo sigue con lo suyo, aunque el reclamo sea viejo.
      expect(by.get(r4!.id)).toMatchObject({ status: "sending", claimedBy: "vivo" });
      const [msg3] = await db.select().from(schema.message).where(and(eq(schema.message.organizationId, A.id), eq(schema.message.id, m3!.id)));
      expect(msg3?.status).toBe("failed");
    });
  });

  it("error transitorio: vuelve a la fila con espera y se reintenta", async () => {
    const { campaignId } = await campaignWith(2);
    let first = true;
    const calls: string[] = [];
    const send: SendFn = async (org, c, r, owner) => {
      calls.push(r.id);
      if (first) {
        first = false;
        await finishClaim(org, r, { status: "retry", error: "Meta pidió bajar el ritmo", code: 130429, delayMs: 20 }, owner);
        return { kind: "retry", rateLimit: true };
      }
      return fakeSend([])(org, c, r, owner);
    };
    await runWithOrganization(A.id, () => dispatchNumber(A.id, A.phoneNumberId, { owner: "c1", send }));
    expect(calls.length).toBe(3);
    expect(await statuses(campaignId)).toEqual({ sent: 2 });
  });

  it("pausa de seguridad por tasa de fallos (configurable), con motivo", async () => {
    await runWithOrganization(A.id, () =>
      saveCampaignSettings(A.id, userId, { ...DEFAULT_CAMPAIGN_SETTINGS, failRatePercent: 50, failRateWindow: 10 })
    );
    const { campaignId } = await campaignWith(40);
    const failing: SendFn = async (org, _c, r, owner) => {
      await finishClaim(org, r, { status: "failed", error: "rechazado", code: 131000 }, owner);
      return { kind: "failed" };
    };
    // La revisión corre al empezar, cada 10 s y cada 5 fallos: se pausa sola
    // en cuanto la ventana (10) está completa, sin quemar los 40.
    await runWithOrganization(A.id, () => dispatchNumber(A.id, A.phoneNumberId, { owner: "c1", send: failing }));
    const c = await campaignRow(campaignId);
    expect(c).toMatchObject({ status: "paused", autoPaused: true });
    expect(c.pauseReason).toMatch(/fallaron 10 de los últimos 10/);
    const s = await statuses(campaignId);
    expect(s.failed).toBe(10);
    expect(s.pending).toBe(30);
    await runWithOrganization(A.id, () => saveCampaignSettings(A.id, userId, DEFAULT_CAMPAIGN_SETTINGS));
  });

  it("pausar, reanudar y cancelar (cancelar omite lo pendiente)", async () => {
    const { campaignId } = await campaignWith(3);
    await runWithOrganization(A.id, async () => {
      expect(await pauseCampaign(A.id, campaignId, { reason: "a mano", auto: false })).toBe(true);
      expect(await pauseCampaign(A.id, campaignId, { reason: "otra vez", auto: false })).toBe(false);
      expect(await resumeCampaign(A.id, campaignId)).toBe(true);
      expect((await campaignRow(campaignId)).status).toBe("sending");
      expect(await cancelCampaign(A.id, campaignId)).toBe(true);
    });
    expect(await statuses(campaignId)).toEqual({ skipped: 3 });
    expect((await campaignRow(campaignId)).status).toBe("cancelled");
  });

  it("programador: arranca la programada vencida y reanuda la pausa por límite vencida", async () => {
    // Destinatarios dados de baja: el despachador los omite sin llamar a Meta.
    const { campaignId: due, contactIds } = await campaignWith(2);
    const { campaignId: limited } = await campaignWith(1);
    await runWithOrganization(A.id, async () => {
      const db = getDb();
      await db
        .update(schema.contact)
        .set({ waConsent: "opt_out" })
        .where(and(eq(schema.contact.organizationId, A.id), sql`${schema.contact.id} in ${contactIds}`));
      await db
        .update(schema.campaign)
        .set({ status: "scheduled", startedAt: null, scheduledAt: new Date(Date.now() - 1000) })
        .where(and(eq(schema.campaign.organizationId, A.id), eq(schema.campaign.id, due)));
      await db
        .update(schema.campaign)
        .set({ status: "paused", autoPaused: true, pauseReason: "límite", resumeAt: new Date(Date.now() - 1000) })
        .where(and(eq(schema.campaign.organizationId, A.id), eq(schema.campaign.id, limited)));
    });
    await campaignSchedulerTick();
    expect((await campaignRow(limited)).status).toBe("sending");
    const started = await campaignRow(due);
    expect(["sending", "completed"]).toContain(started.status);
    expect(started.startedAt).not.toBeNull();
    // El despachador que arrancó el pulso termina la programada (todos omitidos).
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        void campaignRow(due).then((c) => {
          if (c.status === "completed") {
            clearInterval(t);
            resolve();
          }
        });
      }, 100);
    });
    expect(await statuses(due)).toEqual({ skipped: 2 });
    // Que no se quede despachando la otra (su envío real necesitaría Meta).
    await runWithOrganization(A.id, () => cancelCampaign(A.id, limited));
  });

  it("lanzar: solo opt_in, excluidos por motivo y variables desde columnas de la base", async () => {
    const result = await runWithOrganization(A.id, async () => {
      const db = getDb();
      const importId = newId("audienceImport");
      await db.insert(schema.audienceImport).values({
        id: importId,
        organizationId: A.id,
        name: "base",
        fileName: "base.xlsx",
        fileKind: "xlsx",
        consentSource: "Formulario",
        columns: ["cupón"],
        counts: { invalid: 2, duplicate: 1 },
      });
      const mk = async (name: string, consent: "opt_in" | "opt_out" | "desconocido", cupon?: string) => {
        const id = newId("contact");
        const phone = `52463${Math.floor(1e7 + Math.random() * 9e7)}`;
        await db.insert(schema.contact).values({ id, organizationId: A.id, waIdentity: phone, phone, name, waConsent: consent });
        await db.insert(schema.audienceMember).values({ organizationId: A.id, importId, contactId: id, fields: cupon ? { cupón: cupon } : {} });
        return id;
      };
      await mk("Ana", "opt_in", "A10");
      await mk("Beto", "opt_in"); // sin cupón → excluido por variable
      await mk("Ceci", "opt_out", "C30");
      await mk("Dani", "desconocido", "D40");
      const draft = await createCampaign({
        organizationId: A.id,
        userId,
        name: "con columnas",
        templateId,
        variables: [{ kind: "contact_name" }, { kind: "column", column: "cupón" }],
        audience: { importId },
      });
      const launched = await launchCampaign(A.id, draft.id, { scheduledAt: new Date(Date.now() + 3_600_000) });
      const recipients = await db
        .select()
        .from(schema.campaignRecipient)
        .where(and(eq(schema.campaignRecipient.organizationId, A.id), eq(schema.campaignRecipient.campaignId, draft.id)));
      return { launched, recipients };
    });
    expect(result.launched).toMatchObject({
      status: "scheduled",
      total: 1,
      excluded: { optOut: 1, noConsent: 1, missingVariable: 1, invalid: 2, duplicate: 1, archived: 0 },
    });
    expect(result.recipients.map((r) => r.variables)).toEqual([["Ana", "A10"]]);
  });
});
