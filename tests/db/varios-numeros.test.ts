import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { runWithOrganization } from "@/lib/request-context";
import { getOrgCredentials, listWhatsAppNumbers } from "@/server/credentials";
import { processMessagesValue } from "@/server/inbox/ingest";
import type { WebhookValue } from "@/server/inbox/webhook";
import { listConversations } from "@/server/inbox/queries";
import { DEFAULT_FILTERS } from "@/lib/inbox-list";
import { removeNumber, saveCredentials, setNumberLabel } from "@/server/whatsapp/credentials";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 0080 — Varios números oficiales por organización, en UNA bandeja:
 * el principal es el más antiguo, cada chat recuerda por qué número habla,
 * el filtro por número funciona y quitar un número no pierde chats.
 */

function entrante(phoneNumberId: string, wa: string, texto: string): WebhookValue {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "5219990000000", phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: `Cliente ${wa}` }, wa_id: wa }],
    messages: [
      {
        from: wa,
        id: `wamid.n.${Math.random().toString(36).slice(2)}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: texto },
      },
    ],
  } as WebhookValue;
}

describe("varios números oficiales por organización", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let B: Awaited<ReturnType<typeof crearOrganizacion>>;
  let segundo: string;

  beforeAll(async () => {
    A = await crearOrganizacion("Multi A");
    B = await crearOrganizacion("Multi B");
    segundo = `PN2-${A.phoneNumberId}`;
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });

  it("conectar un número distinto AGREGA (no reemplaza) y el principal sigue siendo el primero", async () => {
    await runWithOrganization(A.id, () =>
      saveCredentials({ organizationId: A.id, wabaId: A.wabaId, phoneNumberId: segundo, token: "tok-2", label: "  Ventas   Mérida " })
    );
    const lista = await runWithOrganization(A.id, () => listWhatsAppNumbers(A.id));
    expect(lista.map((n) => n.phoneNumberId)).toEqual([A.phoneNumberId, segundo]);
    expect(lista[0]!.isPrimary).toBe(true);
    expect(lista[1]!.label).toBe("Ventas Mérida");
    // Sin pedir número: el principal. Pidiendo uno: ese.
    const principal = await getOrgCredentials(A.id, "whatsapp");
    expect(principal.ok && principal.value.phoneNumberId).toBe(A.phoneNumberId);
    const otro = await getOrgCredentials(A.id, "whatsapp", { phoneNumberId: segundo });
    expect(otro.ok && otro.value.token).toBe("tok-2");
  });

  it("el número de OTRA organización no se puede tomar: la BD lo impide y no toca al dueño", async () => {
    await runWithOrganization(B.id, () =>
      saveCredentials({ organizationId: B.id, wabaId: B.wabaId, phoneNumberId: segundo, token: "tok-robado" })
    ).catch(() => null);
    const filas = await getSystemDb()
      .select()
      .from(schema.metaCredentials)
      .where(eq(schema.metaCredentials.phoneNumberId, segundo));
    expect(filas).toHaveLength(1);
    expect(filas[0]!.organizationId).toBe(A.id);
  });

  it("cada chat queda en el número por el que escribió y el filtro por número lo separa", async () => {
    await processMessagesValue(entrante(A.phoneNumberId, "5219991110001", "hola cancún"));
    await processMessagesValue(entrante(segundo, "5219991110002", "hola mérida"));
    const db = getSystemDb();
    const convs = await db.select().from(schema.conversation).where(eq(schema.conversation.organizationId, A.id));
    const porNumero = new Map(convs.map((c) => [c.waPhoneNumberId, c]));
    expect(porNumero.has(A.phoneNumberId)).toBe(true);
    expect(porNumero.has(segundo)).toBe(true);

    const access = { organizationId: A.id, userId: "u", seesAll: true };
    const todos = await runWithOrganization(A.id, () => listConversations(access, undefined, { kind: "all" }, "main", undefined, { list: { ...DEFAULT_FILTERS, status: "all" } }));
    expect(todos).toHaveLength(2);
    const soloMerida = await runWithOrganization(A.id, () =>
      listConversations(access, undefined, { kind: "all" }, "main", undefined, { list: { ...DEFAULT_FILTERS, number: segundo, status: "all" } })
    );
    expect(soloMerida).toHaveLength(1);
    expect(soloMerida[0]!.waNumberId).toBe(segundo);
  });

  it("si el mismo cliente escribe por el otro número, el chat (uno solo) pasa a ese número", async () => {
    await processMessagesValue(entrante(segundo, "5219991110001", "ahora por mérida"));
    const db = getSystemDb();
    const convs = await db
      .select({ n: schema.conversation.waPhoneNumberId, c: schema.contact.waIdentity })
      .from(schema.conversation)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
      .where(and(eq(schema.conversation.organizationId, A.id)));
    expect(convs).toHaveLength(2);
    expect(convs.every((c) => c.n === segundo)).toBe(true);
  });

  it("nombrar un número y quitarlo: sus chats pasan al principal", async () => {
    expect(await runWithOrganization(A.id, () => setNumberLabel(A.id, segundo, { label: "Mérida" }))).toBe(true);
    expect(await runWithOrganization(A.id, () => setNumberLabel(A.id, "no-existe", { label: "x" }))).toBe(false);
    expect(await runWithOrganization(A.id, () => removeNumber(A.id, segundo))).toBe(true);
    const convs = await getSystemDb().select().from(schema.conversation).where(eq(schema.conversation.organizationId, A.id));
    expect(convs.every((c) => c.waPhoneNumberId === A.phoneNumberId)).toBe(true);
    const lista = await runWithOrganization(A.id, () => listWhatsAppNumbers(A.id));
    expect(lista.map((n) => n.phoneNumberId)).toEqual([A.phoneNumberId]);
  });
});
