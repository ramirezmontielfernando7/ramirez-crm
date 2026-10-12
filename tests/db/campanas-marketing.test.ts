import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { forgetOrgModules } from "@/server/modules/store";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { applyStatusUpdate } from "@/server/inbox/status";
import { clearMarketingOptOut } from "@/server/inbox/marketing-opt-out";
import { sendRecipient } from "@/server/campaigns/dispatcher";
import { claimNext } from "@/server/campaigns/queue";
import { createCampaign, launchCampaign, previewCampaign } from "@/server/campaigns/service";
import { DEFAULT_CAMPAIGN_SETTINGS, getCampaignSettings, saveCampaignSettings } from "@/server/campaigns/settings";
import { pauseCampaignsWithBlockedTemplates } from "@/server/campaigns/template-guard";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 038 (PR 6) — Campañas listas para reciclar leads, contra Postgres real:
 *
 * - Baja de marketing de Meta (131050) por el webhook de estados: marca el
 *   contacto una sola vez, sin tocar `wa_consent`; una persona la quita.
 * - Tope de frecuencia: una campaña de MARKETING por contacto cada N días
 *   (por defecto 7); utilidad no cuenta, un envío que Meta rechazó tampoco.
 * - Las dos reglas al lanzar (excluidos por motivo) y otra vez al enviar.
 * - Plantilla pausada por Meta: sus campañas programadas o enviando se pausan.
 */

const DAY = 86_400_000;

describe("campañas de marketing: 131050, frecuencia y plantilla pausada", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let userId: string;
  let marketingTpl: string;
  let utilityTpl: string;

  const inOrg = <T>(fn: () => Promise<T>) => runWithOrganization(A.id, fn);

  beforeAll(async () => {
    A = await crearOrganizacion("Marketing A");
    await getSystemDb()
      .insert(schema.organizationModule)
      .values({ organizationId: A.id, campaigns: true })
      .onConflictDoUpdate({ target: schema.organizationModule.organizationId, set: { campaigns: true } });
    forgetOrgModules(A.id);
    userId = newId("user");
    await getSystemDb().insert(schema.user).values({ id: userId, name: "Dueña", email: `${userId}@x.test`, emailVerified: true });
    marketingTpl = newId("template");
    utilityTpl = newId("template");
    await inOrg(() =>
      getDb()
        .insert(schema.template)
        .values([
          { id: marketingTpl, organizationId: A.id, name: "promo", language: "es_MX", category: "MARKETING", body: "Hola {{1}}", status: "approved" },
          { id: utilityTpl, organizationId: A.id, name: "aviso", language: "es_MX", category: "UTILITY", body: "Hola {{1}}", status: "approved" },
        ])
    );
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, userId));
  });

  /** Una base guardada con estos contactos (todos opt_in). */
  async function base(names: string[]): Promise<{ importId: string; ids: Record<string, string> }> {
    return inOrg(async () => {
      const db = getDb();
      const importId = newId("audienceImport");
      await db.insert(schema.audienceImport).values({
        id: importId,
        organizationId: A.id,
        name: `base ${importId}`,
        fileName: "base.csv",
        fileKind: "csv",
        consentSource: "Formulario",
        columns: [],
        counts: {},
      });
      const ids: Record<string, string> = {};
      for (const name of names) {
        const id = newId("contact");
        const phone = `52464${Math.floor(1e7 + Math.random() * 9e7)}`;
        await db.insert(schema.contact).values({ id, organizationId: A.id, waIdentity: phone, phone, name, waConsent: "opt_in" });
        await db.insert(schema.audienceMember).values({ organizationId: A.id, importId, contactId: id, fields: {} });
        ids[name] = id;
      }
      return { importId, ids };
    });
  }

  /** Una campaña ya terminada que le envió `templateId` a `contactId` hace `daysAgo` días. */
  async function pastSend(contactId: string, templateId: string, daysAgo: number, messageStatus: "sent" | "failed" = "sent") {
    await inOrg(async () => {
      const db = getDb();
      const campaignId = newId("campaign");
      const at = new Date(Date.now() - daysAgo * DAY);
      await db.insert(schema.campaign).values({
        id: campaignId,
        organizationId: A.id,
        templateId,
        name: `pasada ${campaignId}`,
        status: "completed",
        startedAt: at,
        finishedAt: at,
        total: 1,
      });
      const conv = await getOrCreateConversation(A.id, contactId);
      const messageId = newId("message");
      await db.insert(schema.message).values({
        id: messageId,
        organizationId: A.id,
        conversationId: conv.id,
        waMessageId: `wamid.past.${messageId}`,
        direction: "out",
        type: "template",
        text: "x",
        status: messageStatus,
        origin: "template",
      });
      await db.insert(schema.campaignRecipient).values({
        id: newId("campaignRecipient"),
        organizationId: A.id,
        campaignId,
        contactId,
        contactName: "x",
        status: "sent",
        sentAt: at,
        messageId,
      });
    });
  }

  async function draftAndLaunch(templateId: string, importId: string, scheduled = true) {
    return inOrg(async () => {
      const draft = await createCampaign({
        organizationId: A.id,
        userId,
        name: `c ${Math.random()}`,
        templateId,
        variables: [{ kind: "contact_name" }],
        audience: { importId },
      });
      const launched = await launchCampaign(A.id, draft.id, scheduled ? { scheduledAt: new Date(Date.now() + 3_600_000) } : {});
      const recipients = await getDb()
        .select({ contactId: schema.campaignRecipient.contactId })
        .from(schema.campaignRecipient)
        .where(and(eq(schema.campaignRecipient.organizationId, A.id), eq(schema.campaignRecipient.campaignId, draft.id)));
      return { launched, recipientIds: recipients.map((r) => r.contactId).sort() };
    });
  }

  async function contactRow(id: string) {
    return inOrg(async () => (await getDb().select().from(schema.contact).where(and(eq(schema.contact.organizationId, A.id), eq(schema.contact.id, id))))[0]!);
  }

  async function marketingEvents(contactId: string) {
    return inOrg(() =>
      getDb()
        .select({ detail: schema.contactActivityEvent.detail, source: schema.contactActivityEvent.source })
        .from(schema.contactActivityEvent)
        .where(
          and(
            eq(schema.contactActivityEvent.organizationId, A.id),
            eq(schema.contactActivityEvent.contactId, contactId),
            eq(schema.contactActivityEvent.kind, "marketing_opt_out")
          )
        )
    );
  }

  it("el tope por defecto es 7 días y la BD rechaza más de 90", async () => {
    expect(DEFAULT_CAMPAIGN_SETTINGS.marketingMinDays).toBe(7);
    expect((await inOrg(() => getCampaignSettings(A.id))).marketingMinDays).toBe(7);
    await expect(
      inOrg(() => getDb().insert(schema.campaignSettings).values({ organizationId: A.id, marketingMinDays: 91 }))
    ).rejects.toThrow();
  });

  it("131050 por el webhook: marca una sola vez, sin tocar el consentimiento; otro código no marca", async () => {
    const { ids } = await base(["Ana"]);
    const wamid = `wamid.131050.${Math.random()}`;
    await inOrg(async () => {
      const conv = await getOrCreateConversation(A.id, ids.Ana!);
      for (const w of [wamid, `${wamid}.x`]) {
        await getDb().insert(schema.message).values({
          id: newId("message"),
          organizationId: A.id,
          conversationId: conv.id,
          waMessageId: w,
          direction: "out",
          type: "template",
          text: "x",
          status: "sent",
          origin: "template",
        });
      }
    });
    const failed = { id: wamid, status: "failed", timestamp: String(Math.floor(Date.now() / 1000)), errors: [{ code: 131050, title: "User's marketing opt-out" }] };
    await inOrg(() => applyStatusUpdate(A.id, failed));
    const after = await contactRow(ids.Ana!);
    expect(after.waMarketingOptOutAt).not.toBeNull();
    expect(after.waConsent).toBe("opt_in");
    const firstAt = after.waMarketingOptOutAt!.getTime();
    // Otro 131050 (otro mensaje) no repite la marca ni la línea de tiempo.
    await inOrg(() => applyStatusUpdate(A.id, { ...failed, id: `${wamid}.x` }));
    expect((await contactRow(ids.Ana!)).waMarketingOptOutAt!.getTime()).toBe(firstAt);
    const events = await marketingEvents(ids.Ana!);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: "sistema", detail: { action: "set", code: "131050" } });

    // Un failed con otro código no marca a nadie.
    const { ids: otros } = await base(["Beto"]);
    const wamid2 = `wamid.otro.${Math.random()}`;
    await inOrg(async () => {
      const conv = await getOrCreateConversation(A.id, otros.Beto!);
      await getDb().insert(schema.message).values({
        id: newId("message"), organizationId: A.id, conversationId: conv.id, waMessageId: wamid2,
        direction: "out", type: "template", text: "x", status: "sent", origin: "template",
      });
    });
    await inOrg(() => applyStatusUpdate(A.id, { ...failed, id: wamid2, errors: [{ code: 131026 }] }));
    expect((await contactRow(otros.Beto!)).waMarketingOptOutAt).toBeNull();
  });

  it("lanzar marketing: fuera la baja 131050 y quien recibió marketing hace < 7 días; utilidad y rechazados no cuentan", async () => {
    const { importId, ids } = await base(["Nuevo", "Baja", "Reciente", "Viejo", "SoloUtilidad", "Rechazado"]);
    await inOrg(() => getDb().update(schema.contact).set({ waMarketingOptOutAt: new Date() }).where(and(eq(schema.contact.organizationId, A.id), eq(schema.contact.id, ids.Baja!))));
    await pastSend(ids.Reciente!, marketingTpl, 3);
    await pastSend(ids.Viejo!, marketingTpl, 10);
    await pastSend(ids.SoloUtilidad!, utilityTpl, 1);
    await pastSend(ids.Rechazado!, marketingTpl, 1, "failed");

    const preview = await inOrg(() => previewCampaign(A.id, { audience: { importId }, templateId: marketingTpl, variables: [{ kind: "contact_name" }] }));
    expect(preview.eligible).toBe(4);
    expect(preview.excluded).toMatchObject({ marketingOptOut: 1, recentMarketing: 1 });

    const m = await draftAndLaunch(marketingTpl, importId);
    expect(m.launched).toMatchObject({ total: 4, excluded: { marketingOptOut: 1, recentMarketing: 1, optOut: 0, noConsent: 0 } });
    expect(m.recipientIds).toEqual([ids.Nuevo, ids.Viejo, ids.SoloUtilidad, ids.Rechazado].sort());

    // Utilidad: ni la baja de marketing ni la frecuencia aplican.
    const u = await draftAndLaunch(utilityTpl, importId);
    expect(u.launched).toMatchObject({ total: 6, excluded: { marketingOptOut: 0, recentMarketing: 0 } });
  });

  it("tope en 0 días: sin límite de frecuencia, pero la baja 131050 sigue", async () => {
    const { importId, ids } = await base(["Reciente0", "Baja0"]);
    await pastSend(ids.Reciente0!, marketingTpl, 1);
    await inOrg(() => getDb().update(schema.contact).set({ waMarketingOptOutAt: new Date() }).where(and(eq(schema.contact.organizationId, A.id), eq(schema.contact.id, ids.Baja0!))));
    await inOrg(() => saveCampaignSettings(A.id, userId, { ...DEFAULT_CAMPAIGN_SETTINGS, marketingMinDays: 0 }));
    try {
      const m = await draftAndLaunch(marketingTpl, importId);
      expect(m.launched).toMatchObject({ total: 1, excluded: { marketingOptOut: 1, recentMarketing: 0 } });
      expect(m.recipientIds).toEqual([ids.Reciente0]);
    } finally {
      await inOrg(() => saveCampaignSettings(A.id, userId, DEFAULT_CAMPAIGN_SETTINGS));
    }
  });

  it("nadie puede recibir la campaña de marketing → 422 con el motivo de marketing", async () => {
    const { importId, ids } = await base(["SoloReciente"]);
    await pastSend(ids.SoloReciente!, marketingTpl, 2);
    await expect(draftAndLaunch(marketingTpl, importId)).rejects.toThrow(/campaña de marketing/);
  });

  it("al enviar se re-verifica: otra campaña de marketing llegó antes o Meta avisó 131050 → omitido, sin llamar a Meta", async () => {
    const { importId, ids } = await base(["X", "Y"]);
    const m = await draftAndLaunch(marketingTpl, importId);
    expect(m.launched.total).toBe(2);
    // Desde el lanzamiento: a X le llegó otra campaña de marketing; Y se dio de baja de marketing.
    await pastSend(ids.X!, marketingTpl, 0);
    await inOrg(() => getDb().update(schema.contact).set({ waMarketingOptOutAt: new Date() }).where(and(eq(schema.contact.organizationId, A.id), eq(schema.contact.id, ids.Y!))));
    const results = await inOrg(async () => {
      const campaign = (await getDb().select().from(schema.campaign).where(and(eq(schema.campaign.organizationId, A.id), eq(schema.campaign.id, m.launched.id))))[0]!;
      const out: { contactId: string | null; kind: string }[] = [];
      for (;;) {
        const r = await claimNext(A.id, campaign.id, "prueba");
        if (!r) break;
        const res = await sendRecipient(A.id, campaign, r, "prueba");
        out.push({ contactId: r.contactId, kind: res.kind });
      }
      const rows = await getDb()
        .select({ contactId: schema.campaignRecipient.contactId, status: schema.campaignRecipient.status, error: schema.campaignRecipient.errorMessage, messageId: schema.campaignRecipient.messageId })
        .from(schema.campaignRecipient)
        .where(and(eq(schema.campaignRecipient.organizationId, A.id), eq(schema.campaignRecipient.campaignId, campaign.id)));
      return { out, rows };
    });
    expect(results.out.every((r) => r.kind === "skipped")).toBe(true);
    const byContact = Object.fromEntries(results.rows.map((r) => [r.contactId, r]));
    expect(byContact[ids.X!]).toMatchObject({ status: "skipped", messageId: null });
    expect(byContact[ids.X!]!.error).toMatch(/otra campaña de marketing hace menos de 7 días/);
    expect(byContact[ids.Y!]).toMatchObject({ status: "skipped", messageId: null });
    expect(byContact[ids.Y!]!.error).toMatch(/131050/);
  });

  it("una persona quita la marca: vuelve a entrar a marketing y queda en la línea de tiempo", async () => {
    const { importId, ids } = await base(["Vuelve"]);
    await inOrg(() => getDb().update(schema.contact).set({ waMarketingOptOutAt: new Date() }).where(and(eq(schema.contact.organizationId, A.id), eq(schema.contact.id, ids.Vuelve!))));
    expect(await inOrg(() => clearMarketingOptOut({ organizationId: A.id, contactId: ids.Vuelve!, actorUserId: userId }))).toBe(true);
    expect(await inOrg(() => clearMarketingOptOut({ organizationId: A.id, contactId: ids.Vuelve!, actorUserId: userId }))).toBe(false);
    expect((await contactRow(ids.Vuelve!)).waMarketingOptOutAt).toBeNull();
    expect(await marketingEvents(ids.Vuelve!)).toEqual([{ source: "usuario", detail: { action: "cleared" } }]);
    const m = await draftAndLaunch(marketingTpl, importId);
    expect(m.recipientIds).toEqual([ids.Vuelve]);
  });

  it("plantilla pausada por Meta: sus campañas programadas o enviando se pausan con el motivo; las demás no", async () => {
    const pausedTpl = newId("template");
    await inOrg(() =>
      getDb().insert(schema.template).values({ id: pausedTpl, organizationId: A.id, name: "promo_pausable", language: "es_MX", category: "MARKETING", body: "Hola {{1}}", status: "approved" })
    );
    const b1 = await base(["P1"]);
    const b2 = await base(["P2"]);
    const withPaused = await draftAndLaunch(pausedTpl, b1.importId);
    const other = await draftAndLaunch(utilityTpl, b2.importId);
    expect(withPaused.launched.status).toBe("scheduled");

    await inOrg(() =>
      getDb()
        .update(schema.template)
        .set({ metaStatus: "PAUSED", pausedReason: "LOW_QUALITY" })
        .where(and(eq(schema.template.organizationId, A.id), eq(schema.template.id, pausedTpl)))
    );
    expect(await inOrg(() => pauseCampaignsWithBlockedTemplates(A.id))).toBe(1);
    expect(await inOrg(() => pauseCampaignsWithBlockedTemplates(A.id))).toBe(0); // idempotente

    const rows = await inOrg(() =>
      getDb()
        .select({ id: schema.campaign.id, status: schema.campaign.status, autoPaused: schema.campaign.autoPaused, reason: schema.campaign.pauseReason, resumeAt: schema.campaign.resumeAt })
        .from(schema.campaign)
        .where(eq(schema.campaign.organizationId, A.id))
    );
    const paused = rows.find((r) => r.id === withPaused.launched.id)!;
    expect(paused).toMatchObject({ status: "paused", autoPaused: true, resumeAt: null });
    expect(paused.reason).toMatch(/«promo_pausable».*pausó por calidad \(LOW_QUALITY\)/);
    expect(rows.find((r) => r.id === other.launched.id)!.status).toBe("scheduled");
  });
});
