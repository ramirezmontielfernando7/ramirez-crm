import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { processMessagesValue } from "@/server/inbox/ingest";
import type { WebhookValue } from "@/server/inbox/webhook";
import { sendText } from "@/server/inbox/send";
import { reauthenticate, REAUTH_MAX_FAILURES, type PlatformAdmin } from "@/server/platform-admin/admins";
import { listPlatformAudit } from "@/server/platform-admin/audit";
import { consumeAccountLink, createAccountLink, inspectAccountLink } from "@/server/platform-admin/links";
import {
  changeOrganizationStatus,
  createOrganization,
  listOrganizations,
  PlatformError,
} from "@/server/platform-admin/organizations";
import { forgetOrgStatus, getOrgStatus, OrganizationInactiveError } from "@/server/platform-admin/org-status";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Fase 3, PR 2 — administrador de plataforma contra Postgres real: alta de
 * organizaciones, suspensión aplicada de verdad (webhook, envío), borrado
 * suave, enlaces de un solo uso y reautenticación con bloqueo.
 */

const ACTOR = { userId: "usr_admin_prueba", email: "admin@plataforma.test" };

function entrante(phoneNumberId: string, texto: string): WebhookValue {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "5215500000000", phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: "Cliente" }, wa_id: "5215598760000" }],
    messages: [
      {
        from: "5215598760000",
        id: `wamid.plat.${Math.random().toString(36).slice(2)}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: texto },
      },
    ],
  } as WebhookValue;
}

describe("alta de organizaciones", () => {
  const creadas: string[] = [];
  afterAll(async () => {
    await borrarOrganizaciones(creadas);
    await getSystemDb().delete(schema.user).where(eq(schema.user.email, "duena@negocio-nuevo.test"));
  });

  it("crea la organización, su Propietario (sin poder entrar aún) y el enlace de activación", async () => {
    const r = await createOrganization({ name: "Negocio Nuevo Ñandú", ownerName: "Dueña", ownerEmail: "Duena@Negocio-Nuevo.test" }, ACTOR, "10.0.0.1");
    creadas.push(r.organizationId);
    expect(r.activationUrl).toMatch(/\/activar\/[A-Za-z0-9_-]{40,}$/);
    const db = getSystemDb();
    const [org] = await db.select().from(schema.organization).where(eq(schema.organization.id, r.organizationId));
    expect(org).toMatchObject({ name: "Negocio Nuevo Ñandú", status: "active" });
    expect(org!.slug).toMatch(/^negocio-nuevo-nandu-[0-9a-f]{6}$/);
    const etapas = await db.select().from(schema.pipelineStage).where(eq(schema.pipelineStage.organizationId, r.organizationId));
    expect(etapas).toHaveLength(5);
    const [miembro] = await db
      .select({ role: schema.member.role, email: schema.user.email })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, r.organizationId));
    expect(miembro).toEqual({ role: "owner", email: "duena@negocio-nuevo.test" });

    // El enlace solo se guarda como hash: la URL no aparece en ninguna fila.
    const token = r.activationUrl.split("/").pop()!;
    const filas = await db.select().from(schema.accountLinkToken);
    expect(JSON.stringify(filas)).not.toContain(token);
    expect(await inspectAccountLink(token)).toMatchObject({ ok: true, purpose: "activate", name: "Dueña" });

    // La bitácora tiene el alta, sin el enlace.
    const bitacora = await listPlatformAudit({ organizationId: r.organizationId });
    expect(bitacora.map((e) => e.action).sort()).toEqual(["link.activation_created", "organization.created"]);
    expect(JSON.stringify(bitacora)).not.toContain(token);
  });

  it("un correo que ya tiene cuenta → 409, sin crear nada", async () => {
    const antes = (await listOrganizations()).length;
    await expect(
      createOrganization({ name: "Otro", ownerName: "X", ownerEmail: "duena@negocio-nuevo.test" }, ACTOR, null)
    ).rejects.toMatchObject({ status: 409, code: "email_taken" });
    expect((await listOrganizations()).length).toBe(antes);
  });

  it("el enlace de activación pone SU contraseña, se quema y cierra sesiones", async () => {
    const r = await createOrganization({ name: "Activa Prueba", ownerName: "Ana", ownerEmail: `ana.${Date.now()}@activa.test` }, ACTOR, null);
    creadas.push(r.organizationId);
    const token = r.activationUrl.split("/").pop()!;
    expect(await consumeAccountLink({ token, password: "corta", ip: "1.1.1.1", userAgent: "ua" })).toEqual({ ok: false, reason: "weak_password" });
    expect(await consumeAccountLink({ token, password: "una-contraseña-larga", ip: "1.1.1.1", userAgent: "ua-prueba" })).toEqual({ ok: true, purpose: "activate" });
    // Segundo uso: nada.
    expect(await consumeAccountLink({ token, password: "otra-contraseña-larga", ip: "1.1.1.1", userAgent: "ua" })).toMatchObject({ ok: false });
    const [fila] = await getSystemDb()
      .select({ hash: schema.account.password })
      .from(schema.account)
      .innerJoin(schema.member, eq(schema.member.userId, schema.account.userId))
      .where(eq(schema.member.organizationId, r.organizationId));
    expect(await verifyPassword({ hash: fila!.hash!, password: "una-contraseña-larga" })).toBe(true);
    const usado = await getSystemDb().select().from(schema.accountLinkToken).where(eq(schema.accountLinkToken.purpose, "activate"));
    expect(usado.some((u) => u.usedIp === "1.1.1.1" && u.usedUserAgent === "ua-prueba")).toBe(true);
  });

  it("dos usos a la vez del mismo enlace: solo uno gana", async () => {
    const r = await createOrganization({ name: "Carrera", ownerName: "C", ownerEmail: `c.${Date.now()}@carrera.test` }, ACTOR, null);
    creadas.push(r.organizationId);
    const token = r.activationUrl.split("/").pop()!;
    const res = await Promise.all([1, 2, 3].map((i) => consumeAccountLink({ token, password: `contraseña-${i}-larga`, ip: null, userAgent: null })));
    expect(res.filter((x) => x.ok)).toHaveLength(1);
  });
});

describe("suspender: la organización deja de operar en todos los caminos", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  beforeAll(async () => {
    A = await crearOrganizacion("Suspender A");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
  });

  it("la organización de la plataforma no se puede suspender", async () => {
    const antes = process.env.PLATFORM_ORG_ID;
    process.env.PLATFORM_ORG_ID = A.id;
    try {
      await expect(changeOrganizationStatus(A.id, "suspend", null, ACTOR, null)).rejects.toBeInstanceOf(PlatformError);
    } finally {
      if (antes === undefined) delete process.env.PLATFORM_ORG_ID;
      else process.env.PLATFORM_ORG_ID = antes;
    }
  });

  it("suspendida: el webhook no entra (va a webhook_unrouted con motivo) y no se envía nada", async () => {
    await changeOrganizationStatus(A.id, "suspend", "falta de pago", ACTOR, "10.0.0.2");
    expect(await getOrgStatus(A.id)).toBe("suspended");

    await processMessagesValue(entrante(A.phoneNumberId, "hola estando suspendida"));
    const db = getSystemDb();
    const mensajes = await db.select().from(schema.message).where(eq(schema.message.organizationId, A.id));
    expect(mensajes).toHaveLength(0);
    const [guardado] = await db
      .select({ reason: schema.webhookUnrouted.reason })
      .from(schema.webhookUnrouted)
      .where(eq(schema.webhookUnrouted.routeKey, A.phoneNumberId));
    expect(guardado?.reason).toBe("org_suspended");

    await expect(
      runWithOrganization(A.id, () => sendText({ organizationId: A.id, conversationId: "cv_inexistente", text: "x" }))
    ).rejects.toBeInstanceOf(OrganizationInactiveError);
  });

  it("no se puede suspender dos veces; reactivar la deja operar otra vez", async () => {
    await expect(changeOrganizationStatus(A.id, "suspend", null, ACTOR, null)).rejects.toMatchObject({ code: "invalid_transition" });
    await changeOrganizationStatus(A.id, "reactivate", null, ACTOR, null);
    expect(await getOrgStatus(A.id)).toBe("active");
    await processMessagesValue(entrante(A.phoneNumberId, "hola ya activa"));
    const mensajes = await getSystemDb().select().from(schema.message).where(eq(schema.message.organizationId, A.id));
    expect(mensajes.length).toBeGreaterThan(0);
  });

  it("suspender cierra las sesiones abiertas de sus personas", async () => {
    const db = getSystemDb();
    const userId = newId("user");
    await db.insert(schema.user).values({ id: userId, name: "Asesor", email: `${userId}@s.test` });
    await db.insert(schema.member).values({ id: newId("member"), organizationId: A.id, userId, role: "asesor" });
    await db.insert(schema.session).values({ id: newId("member").replace("mem", "ses"), token: newId("member"), userId, expiresAt: new Date(Date.now() + 3600_000) });
    await changeOrganizationStatus(A.id, "suspend", null, ACTOR, null);
    expect(await db.select().from(schema.session).where(eq(schema.session.userId, userId))).toHaveLength(0);
    await changeOrganizationStatus(A.id, "reactivate", null, ACTOR, null);
  });

  it("borrado suave: 30 días de gracia, se puede restaurar", async () => {
    const r = await changeOrganizationStatus(A.id, "delete", "lo pidió el cliente", ACTOR, null);
    expect(r.status).toBe("deleted");
    const dias = (r.purgeAfter!.getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(29.9);
    expect(dias).toBeLessThan(30.1);
    forgetOrgStatus(A.id);
    expect(await getOrgStatus(A.id)).toBe("deleted");
    await changeOrganizationStatus(A.id, "restore", null, ACTOR, null);
    const [org] = await getSystemDb().select().from(schema.organization).where(eq(schema.organization.id, A.id));
    expect(org).toMatchObject({ status: "active", purgeAfter: null, deletedAt: null });
    const acciones = (await listPlatformAudit({ organizationId: A.id })).map((e) => e.action);
    expect(acciones).toEqual(expect.arrayContaining(["organization.suspended", "organization.reactivated", "organization.deleted", "organization.restored"]));
  });
});

describe("reautenticación del administrador y enlace de restablecimiento", () => {
  let admin: PlatformAdmin;
  let persona: { id: string; email: string };
  let org: Awaited<ReturnType<typeof crearOrganizacion>>;
  beforeAll(async () => {
    const db = getSystemDb();
    org = await crearOrganizacion("Reset");
    const adminId = newId("user");
    const email = `${adminId}@plataforma.test`;
    await db.insert(schema.user).values({ id: adminId, name: "Admin", email });
    await db.insert(schema.account).values({ id: newId("account"), accountId: adminId, providerId: "credential", userId: adminId, password: await hashPassword("clave-del-admin-123") });
    await db.insert(schema.platformAdmin).values({ userId: adminId });
    admin = { userId: adminId, email, name: "Admin", organizationId: org.id };
    const pid = newId("user");
    persona = { id: pid, email: `${pid}@reset.test` };
    await db.insert(schema.user).values({ id: pid, name: "Persona", email: persona.email });
    await db.insert(schema.member).values({ id: newId("member"), organizationId: org.id, userId: pid, role: "asesor" });
  });
  afterAll(async () => {
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, admin.userId));
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, persona.id));
    await borrarOrganizaciones([org.id]);
  });

  it("contraseña incorrecta: no hay enlace y queda en la bitácora; la correcta pasa", async () => {
    expect(await reauthenticate(admin, "equivocada", "9.9.9.9")).toEqual({ ok: false, reason: "wrong_password" });
    const fallos = (await listPlatformAudit({ limit: 50 })).filter((e) => e.actorUserId === admin.userId && e.action === "reauth.failed");
    expect(fallos).toHaveLength(1);
    expect(await reauthenticate(admin, "clave-del-admin-123", null)).toEqual({ ok: true });
    const [estado] = await getSystemDb().select().from(schema.platformAdmin).where(eq(schema.platformAdmin.userId, admin.userId));
    expect(estado?.failedReauth).toBe(0);
  });

  it(`${REAUTH_MAX_FAILURES} fallos seguidos bloquean, incluso con la contraseña correcta`, async () => {
    for (let i = 0; i < REAUTH_MAX_FAILURES - 1; i++) {
      expect((await reauthenticate(admin, "mal", null)).ok).toBe(false);
    }
    const tercero = await reauthenticate(admin, "mal", null);
    expect(tercero).toMatchObject({ ok: false, reason: "locked" });
    expect(await reauthenticate(admin, "clave-del-admin-123", null)).toMatchObject({ ok: false, reason: "locked" });
    // Pasado el bloqueo vuelve a funcionar.
    const despues = new Date(Date.now() + 16 * 60 * 1000);
    expect(await reauthenticate(admin, "clave-del-admin-123", null, despues)).toEqual({ ok: true });
  });

  it("el restablecimiento: la persona pone su contraseña, sus sesiones se cierran y el equipo ve un aviso", async () => {
    const db = getSystemDb();
    await db.insert(schema.session).values({ id: newId("member").replace("mem", "ses"), token: newId("member"), userId: persona.id, expiresAt: new Date(Date.now() + 3600_000) });
    const link = await createAccountLink(persona.id, "reset", admin.userId);
    expect((link.expiresAt.getTime() - Date.now()) / 3600_000).toBeCloseTo(2, 1);
    // Un enlace nuevo anula el anterior.
    const otro = await createAccountLink(persona.id, "reset", admin.userId);
    expect(await inspectAccountLink(link.url.split("/").pop()!)).toMatchObject({ ok: false, reason: "expired" });
    const r = await consumeAccountLink({ token: otro.url.split("/").pop()!, password: "nueva-de-la-persona", ip: "8.8.8.8", userAgent: "ua" });
    expect(r).toEqual({ ok: true, purpose: "reset" });
    expect(await db.select().from(schema.session).where(eq(schema.session.userId, persona.id))).toHaveLength(0);
    const avisos = await db
      .select({ body: schema.teamChatMessage.body, author: schema.teamChatMessage.authorUserId })
      .from(schema.teamChatMessage)
      .where(and(eq(schema.teamChatMessage.organizationId, org.id)));
    expect(avisos.some((a) => a.author === null && /se restableció la contraseña de Persona/.test(a.body))).toBe(true);
  });

  it("un enlace caducado no sirve", async () => {
    const link = await createAccountLink(persona.id, "reset", admin.userId, new Date(Date.now() - 3 * 3600_000));
    expect(await consumeAccountLink({ token: link.url.split("/").pop()!, password: "algo-largo-123", ip: null, userAgent: null })).toEqual({ ok: false, reason: "expired" });
  });
});
