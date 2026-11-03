import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getSql, getSystemDb, schema } from "@/lib/db";
import type { WebhookPayload } from "@/server/inbox/webhook";
import {
  MAX_ATTEMPTS,
  dueWebhookEvents,
  enqueueWebhookEvent,
  processWebhookEvent,
  purgeFailedWebhookEvents,
  webhookInboxTick,
} from "@/server/webhooks/inbox";
import { borrarOrganizaciones, contarDatosDeClientes, crearOrganizacion } from "./fixtures";

/**
 * Auditoría DF-03 — el webhook se GUARDA antes de responder y un fallo
 * posterior no pierde el mensaje: se reintenta hasta registrarlo.
 */

function evento(phoneNumberId: string, from: string, texto: string, wamid = `wamid.inbox.${Math.random().toString(36).slice(2)}`): WebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "5215500000000", phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: `Cliente ${from}` }, wa_id: from }],
              messages: [{ from, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: texto } }],
            },
          },
        ],
      },
    ],
  } as WebhookPayload;
}

const w = schema.webhookInbox;
const fila = async (id: string) => (await getSystemDb().select().from(w).where(eq(w.id, id)))[0];

describe("DF-03: bandeja durable de webhooks", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;

  beforeAll(async () => {
    A = await crearOrganizacion("Bandeja durable A");
  });
  beforeEach(async () => {
    await getSystemDb().delete(w);
  });
  afterAll(async () => {
    await getSystemDb().delete(w);
    await borrarOrganizaciones([A.id]);
  });

  it("se guarda CIFRADO y, al procesarse bien, el mensaje entra y la fila se borra", async () => {
    const id = await enqueueWebhookEvent("whatsapp", evento(A.phoneNumberId, "5215522220001", "texto secreto del cliente"));
    expect(id).toBeTruthy();
    const guardada = await fila(id!);
    expect(guardada?.status).toBe("pending");
    expect(guardada?.payloadCipher).not.toContain("secreto");
    expect(await processWebhookEvent(id!)).toBe("done");
    expect(await fila(id!)).toBeUndefined();
    expect((await contarDatosDeClientes(A.id)).message).toBeGreaterThanOrEqual(1);
  });

  it("el mismo evento reintentado mientras está pendiente no se guarda dos veces", async () => {
    const e = evento(A.phoneNumberId, "5215522220002", "hola");
    const primero = await enqueueWebhookEvent("whatsapp", e);
    const segundo = await enqueueWebhookEvent("whatsapp", e);
    expect(primero).toBeTruthy();
    expect(segundo).toBeNull();
  });

  it("si el contenedor se cae tras responder, el trabajador lo retoma y el mensaje entra una sola vez", async () => {
    const wamid = `wamid.inbox.caida.${Date.now()}`;
    const antes = (await contarDatosDeClientes(A.id)).message;
    // Guardado y respondido, pero nadie lo procesó (el proceso murió).
    const id = await enqueueWebhookEvent("whatsapp", evento(A.phoneNumberId, "5215522220003", "¿siguen abiertos?", wamid));
    // Otras pruebas comparten la tabla: se pide un lote grande para que no empujen a ésta fuera.
    expect(await dueWebhookEvents(new Date(), 1000)).toContain(id);
    for (let i = 0; i < 5 && (await fila(id!)); i++) await webhookInboxTick();
    expect(await fila(id!)).toBeUndefined();
    expect((await contarDatosDeClientes(A.id)).message).toBe(antes + 1);
    // Meta lo reenvía igual (ya se había borrado): entra otra fila, pero el
    // mensaje NO se duplica.
    const otra = await enqueueWebhookEvent("whatsapp", evento(A.phoneNumberId, "5215522220003", "¿siguen abiertos?", wamid));
    expect(await processWebhookEvent(otra!)).toBe("done");
    expect((await contarDatosDeClientes(A.id)).message).toBe(antes + 1);
  });

  it("lo apartado por otro proceso no se toca hasta que vence su apartado", async () => {
    const id = await enqueueWebhookEvent("whatsapp", evento(A.phoneNumberId, "5215522220004", "hola"));
    const ahora = new Date();
    await getSystemDb().update(w).set({ lockedUntil: new Date(ahora.getTime() + 60_000) }).where(eq(w.id, id!));
    expect(await dueWebhookEvents(ahora)).not.toContain(id);
    expect(await processWebhookEvent(id!, ahora)).toBe("skipped");
    // Venció (el otro proceso se cayó): se retoma.
    const despues = new Date(ahora.getTime() + 120_000);
    expect(await dueWebhookEvents(despues)).toContain(id);
    expect(await processWebhookEvent(id!, despues)).toBe("done");
  });

  it("un fallo al procesar deja la fila para reintentar con espera; tras agotar intentos queda como fallida", async () => {
    const id = await enqueueWebhookEvent("whatsapp", evento(A.phoneNumberId, "5215522220005", "hola"));
    // Contenido que no se puede abrir: el procesamiento falla.
    await getSystemDb().update(w).set({ payloadTag: "AAAAAAAAAAAAAAAAAAAAAA==" }).where(eq(w.id, id!));
    expect(await processWebhookEvent(id!)).toBe("retry");
    const r = await fila(id!);
    expect(r?.status).toBe("pending");
    expect(r?.attempts).toBe(1);
    expect(r?.lockedUntil).toBeNull();
    expect(r!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(r?.lastError).toMatch(/descifrar/);
    expect(await dueWebhookEvents()).not.toContain(id);

    await getSystemDb().update(w).set({ attempts: MAX_ATTEMPTS - 1 }).where(eq(w.id, id!));
    expect(await processWebhookEvent(id!)).toBe("failed");
    expect((await fila(id!))?.status).toBe("failed");
    expect(await dueWebhookEvents(new Date(Date.now() + 24 * 3600_000))).not.toContain(id);

    // 7 días después se borra.
    expect(await purgeFailedWebhookEvents(new Date(Date.now() + 8 * 24 * 3600_000))).toBe(1);
    expect(await fila(id!)).toBeUndefined();
  });

  it("un número sin organización no es un fallo: va a webhook_unrouted y la fila se borra", async () => {
    const id = await enqueueWebhookEvent("whatsapp", evento("PN-INBOX-NADIE", "5215522220006", "hola"));
    expect(await processWebhookEvent(id!)).toBe("done");
    expect(await fila(id!)).toBeUndefined();
    await getSystemDb().delete(schema.webhookUnrouted).where(eq(schema.webhookUnrouted.routeKey, "PN-INBOX-NADIE"));
  });

  it("la app atendiendo a una organización no puede leer la bandeja (solo el pool de sistema)", async () => {
    const usaRoles = new URL(process.env.DATABASE_URL!).username === "vocero_app";
    if (!usaRoles) return;
    await expect(getSql()`select count(*) from webhook_inbox`).rejects.toThrow(/permission denied/);
  });
});
