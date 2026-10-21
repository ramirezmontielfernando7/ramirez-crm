import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { forgetOrgModules } from "@/server/modules/store";
import { getOrCreateConversation } from "@/server/inbox/ingest";
import { dispatchNumber } from "@/server/campaigns/dispatcher";
import { CampaignError, createCampaign } from "@/server/campaigns/service";
import { sendTemplate, TemplateError } from "@/server/whatsapp/templates";
import { getWaMockState, nextTemplateId } from "@/server/dev/wa-mock-state";
import { GET as mockGet, POST as mockPost } from "@/app/api/dev/wa-mock/graph/[...path]/route";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Plantillas con variables CON NOMBRE ({{nombre}}, creadas en Meta) y
 * numéricas ({{1}}) contra Postgres real y el mock de WhatsApp, que responde
 * 132000 como Meta si los parámetros no cuadran con el formato de la
 * plantilla. Cubre el envío manual (Bandeja) y el de una campaña.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
type Outbox = ReturnType<typeof getWaMockState>["outbox"];

const NAMED_BODY = "Hola {{nombre}}, tu cita es el {{fecha_cita}}. Te esperamos, {{nombre}}.";
const POSITIONAL_BODY = "Hola {{1}}, tu cupón es {{2}}";

describe("plantillas con variables con nombre y numéricas", () => {
  let A: Org;
  let named: string;
  let positional: string;
  let userId: string;
  const suf = Math.random().toString(36).slice(2, 8);
  const namedName = `cita_nombre_${suf}`;
  const positionalName = `cupon_num_${suf}`;
  const inA = <T>(fn: () => Promise<T>) => runWithOrganization(A.id, fn);

  /** Graph → el mock de WhatsApp de la app, sin levantar el servidor. */
  function routeToMock() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const path = url.pathname.split("/").filter(Boolean);
        const req = new Request(url, init);
        const ctx = { params: Promise.resolve({ path }) };
        return (init?.method ?? "GET") === "POST" ? mockPost(req, ctx) : mockGet(req, ctx);
      })
    );
  }

  const sentTo = (outbox: Outbox, name: string) =>
    outbox.filter((m) => (m.body as { template?: { name?: string } }).template?.name === name);

  async function contacto(nombre: string) {
    return inA(async () => {
      const phone = `5255${Math.floor(1e7 + Math.random() * 9e7)}1`;
      const id = newId("contact");
      await getDb()
        .insert(schema.contact)
        .values({ id, organizationId: A.id, waIdentity: phone, phone, name: nombre, waConsent: "opt_in" });
      const conv = await getOrCreateConversation(A.id, id);
      return { contactId: id, conversationId: conv.id };
    });
  }

  beforeAll(async () => {
    process.env.WA_MOCK_ENABLED = "true";
    A = await crearOrganizacion("Variables A");
    await getSystemDb()
      .insert(schema.organizationModule)
      .values({ organizationId: A.id, campaigns: true, campaignSendRate: 80 })
      .onConflictDoUpdate({ target: schema.organizationModule.organizationId, set: { campaigns: true, campaignSendRate: 80 } });
    forgetOrgModules(A.id);
    userId = newId("user");
    await getSystemDb().insert(schema.user).values({ id: userId, name: "Coordinadora", email: `${userId}@x.test`, emailVerified: true });
    const tpl = (name: string, body: string) =>
      inA(async () => {
        const id = newId("template");
        await getDb().insert(schema.template).values({
          id,
          organizationId: A.id,
          name,
          language: "es_MX",
          category: "UTILITY",
          body,
          status: "approved",
          metaStatus: "APPROVED",
          components: [{ type: "BODY", text: body }],
        });
        return id;
      });
    named = await tpl(namedName, NAMED_BODY);
    positional = await tpl(positionalName, POSITIONAL_BODY);
    // Las mismas plantillas, aprobadas en la WABA del mock (valida contra ellas).
    for (const [name, body] of [
      [namedName, NAMED_BODY],
      [positionalName, POSITIONAL_BODY],
    ] as const) {
      getWaMockState().templates.push({
        id: nextTemplateId(),
        wabaId: A.wabaId,
        name,
        language: "es_MX",
        category: "UTILITY",
        status: "APPROVED",
        body,
        components: [{ type: "BODY", text: body }],
      });
    }
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    const state = getWaMockState();
    state.templates = state.templates.filter((t) => t.name !== namedName && t.name !== positionalName);
    await borrarOrganizaciones([A.id]);
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, userId));
    delete process.env.WA_MOCK_ENABLED;
  });

  it("envío manual con nombre: cada parámetro lleva su parameter_name y el texto guardado se arma bien", async () => {
    routeToMock();
    const { conversationId } = await contacto("Ana");
    const { messageId } = await inA(() =>
      sendTemplate({ organizationId: A.id, conversationId, templateId: named, variables: ["Ana", "12 de agosto"] })
    );
    const [sent] = sentTo(getWaMockState().outbox, namedName).slice(-1);
    expect((sent!.body as { template: unknown }).template).toMatchObject({
      name: namedName,
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", parameter_name: "nombre", text: "Ana" },
            { type: "text", parameter_name: "fecha_cita", text: "12 de agosto" },
          ],
        },
      ],
    });
    const [m] = await inA(() =>
      getDb().select().from(schema.message).where(and(eq(schema.message.organizationId, A.id), eq(schema.message.id, messageId)))
    );
    expect(m!.text).toBe("Hola Ana, tu cita es el 12 de agosto. Te esperamos, Ana.");
    expect(m!.waMessageId).toBeTruthy();
  });

  it("envío manual numérico: igual que siempre, sin parameter_name", async () => {
    routeToMock();
    const { conversationId } = await contacto("Beto");
    await inA(() =>
      sendTemplate({ organizationId: A.id, conversationId, templateId: positional, variables: ["Beto", "X1"] })
    );
    const [sent] = sentTo(getWaMockState().outbox, positionalName).slice(-1);
    expect((sent!.body as { template: { components: unknown } }).template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Beto" }, { type: "text", text: "X1" }] },
    ]);
  });

  it("falta un valor: el error nombra la variable ({{fecha_cita}}) y no llama a Meta", async () => {
    routeToMock();
    const { conversationId } = await contacto("Caro");
    const antes = getWaMockState().outbox.length;
    const err = await inA(() =>
      sendTemplate({ organizationId: A.id, conversationId, templateId: named, variables: ["Caro"] })
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TemplateError);
    expect((err as TemplateError).message).toContain("{{fecha_cita}}");
    expect(getWaMockState().outbox.length).toBe(antes);
  });

  it("el mock rechaza como Meta (132000) una plantilla con nombre enviada como numérica", async () => {
    routeToMock();
    const res = await fetch(`https://graph.facebook.com/v25.0/${A.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: "Bearer tok", "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: "5255111122223",
        type: "template",
        template: {
          name: namedName,
          language: { code: "es_MX" },
          components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "hoy" }] }],
        },
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(132000);
  });

  it("campaña: valida con los nombres y el despachador envía con parameter_name (y la numérica sin él)", async () => {
    // La validación de la campaña habla en nombres de variable.
    const err = await inA(() =>
      createCampaign({
        organizationId: A.id,
        userId,
        name: "citas",
        templateId: named,
        variables: [{ kind: "contact_name" }, { kind: "fixed", value: "  " }],
        audience: { tagIds: [] },
      })
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CampaignError);
    expect((err as CampaignError).message).toContain("{{fecha_cita}}");
    const draft = await inA(() =>
      createCampaign({
        organizationId: A.id,
        userId,
        name: "citas",
        templateId: named,
        variables: [{ kind: "contact_name" }, { kind: "fixed", value: "lunes" }],
        audience: { tagIds: [] },
      })
    );
    expect(draft.variables).toHaveLength(2);

    routeToMock();
    const make = (templateId: string, contactId: string, variables: string[]) =>
      inA(async () => {
        const db = getDb();
        const campaignId = newId("campaign");
        await db.insert(schema.campaign).values({
          id: campaignId,
          organizationId: A.id,
          templateId,
          name: `camp ${campaignId}`,
          status: "sending",
          phoneNumberId: A.phoneNumberId,
          startedAt: new Date(),
          total: 1,
        });
        const [c] = await db.select().from(schema.contact).where(and(eq(schema.contact.organizationId, A.id), eq(schema.contact.id, contactId)));
        await db.insert(schema.campaignRecipient).values({
          id: newId("campaignRecipient"),
          organizationId: A.id,
          campaignId,
          contactId,
          contactName: c!.name,
          phone: c!.phone,
          variables,
        });
        return campaignId;
      });
    const dani = await contacto("Dani");
    const eli = await contacto("Eli");
    const campNamed = await make(named, dani.contactId, ["Dani", "lunes"]);
    const campPositional = await make(positional, eli.contactId, ["Eli", "CUPON9"]);
    await inA(() => dispatchNumber(A.id, A.phoneNumberId, { owner: "prueba-variables" }));

    const recipients = await inA(() =>
      getDb()
        .select({ campaignId: schema.campaignRecipient.campaignId, status: schema.campaignRecipient.status, error: schema.campaignRecipient.errorMessage })
        .from(schema.campaignRecipient)
        .where(eq(schema.campaignRecipient.organizationId, A.id))
    );
    expect(recipients.find((r) => r.campaignId === campNamed)).toMatchObject({ status: "sent" });
    expect(recipients.find((r) => r.campaignId === campPositional)).toMatchObject({ status: "sent" });

    const outbox = getWaMockState().outbox;
    const n = sentTo(outbox, namedName).find((m) => JSON.stringify(m.body).includes("Dani"));
    expect((n!.body as { template: { components: unknown } }).template.components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", parameter_name: "nombre", text: "Dani" },
          { type: "text", parameter_name: "fecha_cita", text: "lunes" },
        ],
      },
    ]);
    const p = sentTo(outbox, positionalName).find((m) => JSON.stringify(m.body).includes("Eli"));
    expect((p!.body as { template: { components: unknown } }).template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Eli" }, { type: "text", text: "CUPON9" }] },
    ]);
  });
});
