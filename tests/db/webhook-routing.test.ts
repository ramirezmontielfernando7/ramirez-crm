import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { processMessagesValue } from "@/server/inbox/ingest";
import type { WebhookValue } from "@/server/inbox/webhook";
import { borrarOrganizaciones, contarDatosDeClientes, crearOrganizacion } from "./fixtures";

/**
 * Fase 1 multitenant — un evento del webhook para el número de la
 * organización A solo escribe en A. Contra Postgres real: la organización de
 * cada fila la pone la ingesta a partir del `phone_number_id`, y aquí se
 * comprueba en las filas, no en un SQL inspeccionado.
 */

function entrante(phoneNumberId: string, from: string, texto: string): WebhookValue {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "5215500000000", phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: `Cliente ${from}` }, wa_id: from }],
    messages: [
      {
        from,
        id: `wamid.test.${from}.${Math.random().toString(36).slice(2)}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: texto },
      },
    ],
  } as WebhookValue;
}

describe("webhook: el phone_number_id decide la organización", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let B: Awaited<ReturnType<typeof crearOrganizacion>>;

  beforeAll(async () => {
    A = await crearOrganizacion("Webhook A");
    B = await crearOrganizacion("Webhook B");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });

  it("un mensaje al número de A crea contacto, conversación y mensaje SOLO en A", async () => {
    await processMessagesValue(entrante(A.phoneNumberId, "5215511110001", "hola A"));
    const a = await contarDatosDeClientes(A.id);
    const b = await contarDatosDeClientes(B.id);
    expect(a.contact).toBe(1);
    expect(a.conversation).toBe(1);
    expect(a.message).toBe(1);
    expect(b).toEqual({ contact: 0, conversation: 0, message: 0, lead: 0 });
  });

  it("el mismo cliente escribiendo a los dos números queda como DOS contactos separados", async () => {
    const tel = "5215511110002";
    await processMessagesValue(entrante(A.phoneNumberId, tel, "a A"));
    await processMessagesValue(entrante(B.phoneNumberId, tel, "a B"));
    const db = getDb();
    const filas = await db
      .select({ org: schema.contact.organizationId })
      .from(schema.contact)
      .where(eq(schema.contact.waIdentity, "525511110002")); // 521 → 52 (identity.ts)
    expect(filas.map((f) => f.org).sort()).toEqual([A.id, B.id].sort());
    // Los mensajes de B jamás tienen la conversación de A, ni al revés.
    const mensajesB = await db
      .select({ conv: schema.message.conversationId, org: schema.conversation.organizationId })
      .from(schema.message)
      .innerJoin(schema.conversation, eq(schema.conversation.id, schema.message.conversationId))
      .where(eq(schema.message.organizationId, B.id));
    expect(mensajesB.length).toBeGreaterThan(0);
    expect(mensajesB.every((m) => m.org === B.id)).toBe(true);
  });

  it("un número que no es de nadie no crea nada en ninguna organización", async () => {
    const antesA = await contarDatosDeClientes(A.id);
    const antesB = await contarDatosDeClientes(B.id);
    await processMessagesValue(entrante("PN-DE-NADIE", "5215511110003", "¿hola?"));
    expect(await contarDatosDeClientes(A.id)).toEqual(antesA);
    expect(await contarDatosDeClientes(B.id)).toEqual(antesB);
  });

  it("un acuse de estado de un wamid de A enviado al número de B no toca el mensaje de A", async () => {
    await processMessagesValue(entrante(A.phoneNumberId, "5215511110004", "estado"));
    const db = getDb();
    const [msg] = await db
      .select()
      .from(schema.message)
      .where(eq(schema.message.organizationId, A.id))
      .limit(1);
    expect(msg).toBeDefined();
    const antes = msg!.status;
    await processMessagesValue({
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "5215500000000", phone_number_id: B.phoneNumberId },
      statuses: [
        { id: msg!.waMessageId!, status: "failed", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "x" },
      ],
    } as WebhookValue);
    const [despues] = await db.select().from(schema.message).where(eq(schema.message.id, msg!.id));
    expect(despues!.status).toBe(antes);
  });
});
