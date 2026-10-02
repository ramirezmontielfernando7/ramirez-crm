import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getSystemDb as getDb, schema } from "@/lib/db";
import { runWithOrganization } from "@/lib/request-context";
import { processMessagesValue } from "@/server/inbox/ingest";
import { saveMessagingSettings, DEFAULT_MESSAGING_SETTINGS } from "@/server/messaging-settings";
import type { WebhookValue } from "@/server/inbox/webhook";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Campañas v2, PR 1 — Baja por palabra clave (STOP/BAJA) contra Postgres
 * real: pasa a opt_out, queda en la línea de tiempo una sola vez, no aplica
 * a mensajes que solo CONTIENEN la palabra, y cada organización tiene sus
 * propias palabras.
 */

function entrante(phoneNumberId: string, from: string, msg: Record<string, unknown>): WebhookValue {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "5215500000000", phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: `Cliente ${from}` }, wa_id: from }],
    messages: [
      {
        from,
        id: `wamid.baja.${Math.random().toString(36).slice(2)}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        ...msg,
      },
    ],
  } as WebhookValue;
}
const texto = (body: string) => ({ type: "text", text: { body } });

describe("bajas por palabra clave", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let B: Awaited<ReturnType<typeof crearOrganizacion>>;

  beforeAll(async () => {
    A = await crearOrganizacion("Bajas A");
    B = await crearOrganizacion("Bajas B");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });

  async function contacto(org: string, phone: string) {
    const [c] = await getDb()
      .select()
      .from(schema.contact)
      .where(and(eq(schema.contact.organizationId, org), eq(schema.contact.waIdentity, phone)));
    return c!;
  }
  async function bajasEnBitacora(org: string, contactId: string) {
    return getDb()
      .select()
      .from(schema.contactActivityEvent)
      .where(
        and(
          eq(schema.contactActivityEvent.organizationId, org),
          eq(schema.contactActivityEvent.contactId, contactId),
          eq(schema.contactActivityEvent.kind, "consent_changed")
        )
      );
  }

  it("«BAJA» pasa al contacto a opt_out y lo anota UNA vez en la línea de tiempo", async () => {
    const phone = "5255200000001";
    await processMessagesValue(entrante(A.phoneNumberId, phone, texto("hola")));
    await getDb().update(schema.contact).set({ waConsent: "opt_in" }).where(eq(schema.contact.waIdentity, phone));
    await processMessagesValue(entrante(A.phoneNumberId, phone, texto("¡BAJA!")));
    const c = await contacto(A.id, phone);
    expect(c.waConsent).toBe("opt_out");
    expect(c.waConsentSource).toMatch(/baja/i);
    // Un segundo «baja» no repite la bitácora.
    await processMessagesValue(entrante(A.phoneNumberId, phone, texto("baja")));
    const ev = await bajasEnBitacora(A.id, c.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.source).toBe("sistema");
    expect(ev[0]!.detail).toMatchObject({ from: "opt_in", to: "opt_out", keyword: "baja" });
    // El mensaje del cliente sí entró a la bandeja.
    const msgs = await getDb().select().from(schema.message).where(eq(schema.message.organizationId, A.id));
    expect(msgs.filter((m) => m.direction === "in").length).toBeGreaterThanOrEqual(3);
    // Respuesta automática apagada por defecto: no salió nada.
    expect(msgs.filter((m) => m.direction === "out")).toHaveLength(0);
  });

  it("un mensaje que solo CONTIENE la palabra no da de baja", async () => {
    const phone = "5255200000002";
    await processMessagesValue(entrante(A.phoneNumberId, phone, texto("no me des de baja porfa")));
    expect((await contacto(A.id, phone)).waConsent).toBe("desconocido");
  });

  it("el botón de respuesta rápida de la plantilla también cuenta", async () => {
    const phone = "5255200000003";
    await processMessagesValue(
      entrante(A.phoneNumberId, phone, { type: "button", button: { text: "Detener promociones", payload: "STOP" } })
    );
    const c = await contacto(A.id, phone);
    expect(c.waConsent).toBe("opt_out");
    const [m] = await getDb().select().from(schema.message).where(eq(schema.message.conversationId,
      (await getDb().select().from(schema.conversation).where(eq(schema.conversation.contactId, c.id)))[0]!.id));
    expect(m!.text).toBe("Detener promociones");
    expect(m!.type).toBe("text");
  });

  it("cada organización con sus palabras; apagado no da de baja", async () => {
    await runWithOrganization(B.id, () =>
      saveMessagingSettings(B.id, { ...DEFAULT_MESSAGING_SETTINGS, stopKeywords: ["cancelar"] }, null)
    );
    await processMessagesValue(entrante(B.phoneNumberId, "5255200000004", texto("baja")));
    expect((await contacto(B.id, "5255200000004")).waConsent).toBe("desconocido");
    await processMessagesValue(entrante(B.phoneNumberId, "5255200000005", texto("Cancelar")));
    expect((await contacto(B.id, "5255200000005")).waConsent).toBe("opt_out");
    // En A «cancelar» no es palabra de baja.
    await processMessagesValue(entrante(A.phoneNumberId, "5255200000006", texto("cancelar")));
    expect((await contacto(A.id, "5255200000006")).waConsent).toBe("desconocido");

    await runWithOrganization(B.id, () =>
      saveMessagingSettings(B.id, { ...DEFAULT_MESSAGING_SETTINGS, stopKeywordsEnabled: false, stopKeywords: ["cancelar"] }, null)
    );
    await processMessagesValue(entrante(B.phoneNumberId, "5255200000007", texto("cancelar")));
    expect((await contacto(B.id, "5255200000007")).waConsent).toBe("desconocido");
  });
});
