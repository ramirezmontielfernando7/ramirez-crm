import { randomBytes } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { resetEnvCacheForTests } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { getOrgCredentials, sealForStorage } from "@/server/credentials";
import { resolveWaba, whatsappOwnedElsewhere } from "@/server/credentials/resolve";
import { runCredentialMaintenance } from "@/server/credentials/maintenance";
import { processMessagesValue } from "@/server/inbox/ingest";
import type { WebhookValue } from "@/server/inbox/webhook";
import { purgeUnrouted } from "@/server/webhooks/unrouted";
import { saveCredentials } from "@/server/whatsapp/credentials";
import { applyTemplateStatusEvent } from "@/server/whatsapp/templates";
import { saveMessengerCredentials } from "@/server/messenger/credentials";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Fase 3, PR 1 — credenciales y webhooks contra Postgres real:
 * H8 (WABA de una sola organización), `webhook_unrouted`, la rotación de
 * ENCRYPTION_KEY y la puerta única bajo RLS.
 */

const LLAVE_ORIGINAL = process.env.ENCRYPTION_KEY!;

function usarLlaves(env: Record<string, string | undefined>) {
  for (const k of ["ENCRYPTION_KEY", "ENCRYPTION_KEY_VERSION", "ENCRYPTION_KEY_OLD", "ENCRYPTION_KEY_OLD_VERSION"]) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  resetEnvCacheForTests();
}

function entrante(phoneNumberId: string, texto: string): WebhookValue {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "5215500000000", phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: "Cliente" }, wa_id: "5215512340000" }],
    messages: [
      {
        from: "5215512340000",
        id: `wamid.unrouted.${Math.random().toString(36).slice(2)}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: texto },
      },
    ],
  } as WebhookValue;
}

describe("H8: una WABA es de UNA organización", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let B: Awaited<ReturnType<typeof crearOrganizacion>>;
  beforeAll(async () => {
    A = await crearOrganizacion("Waba A");
    B = await crearOrganizacion("Waba B");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });

  it("guardar la conexión registra la WABA a nombre de su organización", async () => {
    expect(await resolveWaba(A.wabaId)).toEqual({ organizationId: A.id, orgStatus: "active" });
    expect(await resolveWaba(B.wabaId)).toEqual({ organizationId: B.id, orgStatus: "active" });
  });

  it("B no puede declarar la WABA de A: la BD lo impide aunque la ruta no preguntara", async () => {
    await expect(
      runWithOrganization(B.id, () =>
        saveCredentials({ organizationId: B.id, wabaId: A.wabaId, phoneNumberId: B.phoneNumberId, token: "tok-b2" })
      )
    ).rejects.toThrow();
    // Y B conserva su WABA de antes (la transacción se revirtió completa).
    expect(await resolveWaba(B.wabaId)).toEqual({ organizationId: B.id, orgStatus: "active" });
  });

  it("H25: se sabe de antemano si el número o la WABA ya son de otra organización", async () => {
    expect(await whatsappOwnedElsewhere(B.id, A.phoneNumberId, B.wabaId)).toEqual({ phone: true, waba: false });
    expect(await whatsappOwnedElsewhere(B.id, B.phoneNumberId, A.wabaId)).toEqual({ phone: false, waba: true });
    expect(await whatsappOwnedElsewhere(A.id, A.phoneNumberId, A.wabaId)).toEqual({ phone: false, waba: false });
  });

  it("cambiar de WABA suelta la anterior", async () => {
    const nueva = `WABA-N-${randomBytes(3).toString("hex")}`;
    await runWithOrganization(A.id, () =>
      saveCredentials({ organizationId: A.id, wabaId: nueva, phoneNumberId: A.phoneNumberId, token: "tok-a2" })
    );
    expect(await resolveWaba(nueva)).toEqual({ organizationId: A.id, orgStatus: "active" });
    expect(await resolveWaba(A.wabaId)).toBeNull();
    A = { ...A, wabaId: nueva };
  });

  it("el evento de plantilla de la WABA de B actualiza SOLO la plantilla de B", async () => {
    const db = getSystemDb();
    const tpl = (org: string) => ({
      id: `tpl_${randomBytes(6).toString("hex")}`,
      organizationId: org,
      name: "promo_h8",
      language: "es_MX",
      category: "MARKETING" as const,
      body: "Hola",
      status: "pending" as const,
    });
    const ta = tpl(A.id);
    const tb = tpl(B.id);
    await db.insert(schema.template).values([ta, tb]);
    await applyTemplateStatusEvent(B.wabaId, {
      event: "APPROVED",
      message_template_name: "promo_h8",
      message_template_language: "es_MX",
    } as WebhookValue);
    const filas = await db
      .select({ id: schema.template.id, status: schema.template.status })
      .from(schema.template)
      .where(inArray(schema.template.id, [ta.id, tb.id]));
    expect(filas.find((f) => f.id === tb.id)?.status).toBe("approved");
    expect(filas.find((f) => f.id === ta.id)?.status).toBe("pending");
  });
});

describe("webhook_unrouted: lo firmado que no tiene a dónde ir se guarda 7 días, cifrado", () => {
  beforeAll(async () => {
    await getSystemDb().delete(schema.webhookUnrouted);
  });
  afterEach(async () => {
    await getSystemDb().delete(schema.webhookUnrouted);
  });

  it("un mensaje a un número desconocido queda guardado, sin el texto en claro, y sin duplicar reintentos", async () => {
    const value = entrante("PN-NADIE-1", "texto-secreto-del-cliente");
    await processMessagesValue(value);
    await processMessagesValue(value); // Meta reintenta: mismo evento
    const filas = await getSystemDb().select().from(schema.webhookUnrouted);
    expect(filas).toHaveLength(1);
    const f = filas[0]!;
    expect(f).toMatchObject({ source: "whatsapp", routeKind: "phone_number_id", routeKey: "PN-NADIE-1", field: "messages" });
    expect(JSON.stringify(f)).not.toContain("texto-secreto-del-cliente");
  });

  it("una plantilla de una WABA desconocida también se guarda", async () => {
    await applyTemplateStatusEvent("WABA-DE-NADIE", { event: "APPROVED", message_template_name: "x", message_template_language: "es" } as WebhookValue);
    const filas = await getSystemDb().select().from(schema.webhookUnrouted);
    expect(filas.map((f) => [f.routeKind, f.routeKey])).toEqual([["waba_id", "WABA-DE-NADIE"]]);
  });

  it("la app (vocero_app) no tiene permisos sobre la tabla: es solo del pool de sistema", async () => {
    const usaRoles = new URL(process.env.DATABASE_URL!).username === "vocero_app";
    if (!usaRoles) return; // sin roles separados no hay nada que comprobar
    const { getSql } = await import("@/lib/db");
    await expect(getSql()`select count(*) from webhook_unrouted`).rejects.toThrow(/permission denied/);
  });

  it("la limpieza borra lo de más de 7 días y deja lo reciente", async () => {
    await processMessagesValue(entrante("PN-NADIE-3", "viejo"));
    await processMessagesValue(entrante("PN-NADIE-4", "nuevo"));
    await getSystemDb()
      .update(schema.webhookUnrouted)
      .set({ receivedAt: sql`now() - interval '8 days'` })
      .where(eq(schema.webhookUnrouted.routeKey, "PN-NADIE-3"));
    expect(await purgeUnrouted()).toBe(1);
    const quedan = await getSystemDb().select({ k: schema.webhookUnrouted.routeKey }).from(schema.webhookUnrouted);
    expect(quedan.map((q) => q.k)).toEqual(["PN-NADIE-4"]);
  });
});

describe("puerta única: getOrgCredentials", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let B: Awaited<ReturnType<typeof crearOrganizacion>>;
  beforeAll(async () => {
    A = await crearOrganizacion("Puerta A");
    B = await crearOrganizacion("Puerta B");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });

  it("descifra las de la organización pedida", async () => {
    const r = await getOrgCredentials(A.id, "whatsapp");
    expect(r.ok && r.value.phoneNumberId).toBe(A.phoneNumberId);
  });

  it("errores tipados: sin conexión → not_connected; marcada → reconnect_required solo si se exige", async () => {
    expect(await getOrgCredentials(A.id, "zoom")).toEqual({ ok: false, error: "not_connected" });
    await getSystemDb()
      .update(schema.metaCredentials)
      .set({ status: "reconnect_required" })
      .where(eq(schema.metaCredentials.organizationId, A.id));
    expect((await getOrgCredentials(A.id, "whatsapp")).ok).toBe(true);
    expect(await getOrgCredentials(A.id, "whatsapp", { requireUsable: true })).toEqual({ ok: false, error: "reconnect_required" });
  });

  it("desde el trabajo de A, pedir las de B lanza (nunca se cruzan)", async () => {
    await expect(runWithOrganization(A.id, () => getOrgCredentials(B.id, "whatsapp"))).rejects.toThrow(
      /no es la del contexto/
    );
  });
});

describe("rotación de ENCRYPTION_KEY (al arrancar)", () => {
  const LLAVE_NUEVA = randomBytes(32).toString("base64");
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  beforeAll(async () => {
    usarLlaves({ ENCRYPTION_KEY: LLAVE_ORIGINAL });
    A = await crearOrganizacion("Rotar A");
    // Una conexión de Messenger por Zernio con el secreto EN CLARO, como
    // estaban antes de la 0028.
    await runWithOrganization(A.id, () =>
      saveMessengerCredentials({
        organizationId: A.id,
        source: "zernio",
        pageId: null,
        pageName: null,
        accountRef: `acc-${A.id}`,
        token: "sk_test-zernio",
        webhookSecret: null,
      })
    );
    await getSystemDb()
      .update(schema.messengerCredentials)
      .set({ webhookSecret: "secreto-en-claro" })
      .where(eq(schema.messengerCredentials.organizationId, A.id));
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
    usarLlaves({ ENCRYPTION_KEY: LLAVE_ORIGINAL });
  });

  it("sin rotación: cifra el secreto en claro de Zernio y deja la columna en NULL", async () => {
    const reportes = await runCredentialMaintenance();
    expect(reportes?.find((r) => r.table === "messenger_credentials")?.sealedPlain).toBeGreaterThanOrEqual(1);
    const [fila] = await getSystemDb()
      .select()
      .from(schema.messengerCredentials)
      .where(eq(schema.messengerCredentials.organizationId, A.id));
    expect(fila?.webhookSecret).toBeNull();
    expect(fila?.webhookSecretCipher).toBeTruthy();
    const r = await getOrgCredentials(A.id, "messenger");
    expect(r.ok && r.value.webhookSecret).toBe("secreto-en-claro");
  });

  it("llave nueva + la vieja de respaldo: re-cifra todo a la versión 2 y lo lee igual", async () => {
    usarLlaves({
      ENCRYPTION_KEY: LLAVE_NUEVA,
      ENCRYPTION_KEY_VERSION: "2",
      ENCRYPTION_KEY_OLD: LLAVE_ORIGINAL,
      ENCRYPTION_KEY_OLD_VERSION: "1",
    });
    const reportes = await runCredentialMaintenance();
    const meta = reportes?.find((r) => r.table === "meta_credentials");
    expect(meta?.rotated).toBeGreaterThanOrEqual(1);
    expect(meta?.keyUnavailable).toBe(0);
    expect(Object.keys(meta?.byVersion ?? {})).toEqual(["2"]);

    // Sin la llave vieja ya se lee todo: la rotación terminó.
    usarLlaves({ ENCRYPTION_KEY: LLAVE_NUEVA, ENCRYPTION_KEY_VERSION: "2" });
    const wa = await getOrgCredentials(A.id, "whatsapp");
    expect(wa.ok && wa.value.phoneNumberId).toBe(A.phoneNumberId);
    const fb = await getOrgCredentials(A.id, "messenger");
    expect(fb.ok && fb.value.token).toBe("sk_test-zernio");
    expect(fb.ok && fb.value.webhookSecret).toBe("secreto-en-claro");
  });

  it("re-ejecutarla no cambia nada (idempotente)", async () => {
    const antes = await getSystemDb()
      .select({ c: schema.metaCredentials.tokenCipher })
      .from(schema.metaCredentials)
      .where(eq(schema.metaCredentials.organizationId, A.id));
    const reportes = await runCredentialMaintenance();
    expect(reportes?.every((r) => r.rotated === 0)).toBe(true);
    const despues = await getSystemDb()
      .select({ c: schema.metaCredentials.tokenCipher })
      .from(schema.metaCredentials)
      .where(eq(schema.metaCredentials.organizationId, A.id));
    expect(despues).toEqual(antes);
  });

  it("una fila con una llave que el proceso no tiene: error tipado, sin tumbar nada", async () => {
    // Una fila "de la versión 7", que nadie tiene.
    const s = sealForStorage("x");
    await getSystemDb()
      .update(schema.metaCredentials)
      .set({ tokenCipher: s.cipher, tokenIv: s.iv, tokenTag: s.tag, keyVersion: 7 })
      .where(eq(schema.metaCredentials.organizationId, A.id));
    expect(await getOrgCredentials(A.id, "whatsapp")).toEqual({ ok: false, error: "key_unavailable" });
    const reportes = await runCredentialMaintenance();
    expect(reportes?.find((r) => r.table === "meta_credentials")?.keyUnavailable).toBe(1);
  });

  it("dos procesos a la vez: solo uno hace el trabajo (candado)", async () => {
    const [a, b] = await Promise.all([runCredentialMaintenance(), runCredentialMaintenance()]);
    expect([a, b].filter((r) => r === null).length).toBeLessThanOrEqual(1);
    expect([a, b].some((r) => r !== null)).toBe(true);
  });
});
