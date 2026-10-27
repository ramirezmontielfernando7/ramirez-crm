import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb, getSystemDb, getSystemSql, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { assignServer, getConnection } from "@/server/credentials/direct";
import { getDirectConnection } from "@/server/credentials/direct-instance";
import { getOrCreateContact, getOrCreateConversation } from "@/server/inbox/ingest";
import { countUnread, getConversation, listConversations } from "@/server/inbox/queries";
import { forgetOrgModules, getOrgModules } from "@/server/modules";
import { updateOrgModules } from "@/server/modules/store";
import { organizationDirect } from "@/server/platform-admin/direct-servers";
import { changeOrganizationModules, PlatformError } from "@/server/platform-admin/organizations";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Mi número (046), PR 1 — los datos de la 0057 contra Postgres real (la app
 * como `vocero_app`, con RLS):
 *
 * - Un cliente tiene UN chat con el número de la empresa y uno por cada «Mi
 *   número»; el contacto sigue siendo uno solo.
 * - Una conexión de la empresa por organización; una por cada número.
 * - Aislado por defecto: el código de hoy (lista, conteos, abrir un chat,
 *   buscar el chat de un contacto, la conexión de la empresa) jamás toca lo
 *   de un «Mi número».
 * - Un número, un chat o un contacto privado de A no pueden colgar de B.
 * - «Mi número» requiere la conexión directa; borrar la organización borra
 *   todo junto.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const sys = () => getSystemDb();
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

async function codigo(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code ?? "desconocido";
  }
}

async function crearUsuario(): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name: "Ana", email: `${id}@x.test`, emailVerified: true });
  return id;
}

async function crearNumero(organizationId: string, userId: string, kind: "personal" | "empresa" = "personal") {
  const id = newId("directNumber");
  await sys().insert(schema.directNumber).values({ id, organizationId, userId, kind });
  return id;
}

describe("Mi número — datos (0057)", () => {
  let A: Org;
  let B: Org;
  let ana: string;
  let luis: string;
  let servidor: string;

  beforeAll(async () => {
    A = await crearOrganizacion("MiNumero A");
    B = await crearOrganizacion("MiNumero B");
    ana = await crearUsuario();
    luis = await crearUsuario();
    servidor = newId("evolutionServer");
    await sys().insert(schema.evolutionServer).values({
      id: servidor,
      name: "Servidor de prueba",
      baseUrl: `https://${servidor}.test`,
      apiKeyCipher: "x",
      apiKeyIv: "x",
      apiKeyTag: "x",
      apiKeyLast4: "abcd",
    });
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
    await sys().delete(schema.evolutionServer).where(eq(schema.evolutionServer.id, servidor));
    await sys().delete(schema.user).where(inArray(schema.user.id, [ana, luis]));
  });

  it("los cuatro interruptores nacen apagados y el número nace personal", async () => {
    const id = await crearNumero(A.id, ana);
    const [n] = await as(A.id, () => getDb().select().from(schema.directNumber).where(eq(schema.directNumber.id, id)));
    expect(n).toMatchObject({
      kind: "personal",
      shareClients: false,
      overlapNotice: false,
      allowViewRequests: false,
      aiReplies: false,
      revokedAt: null,
    });
  });

  it("un número vivo por persona; uno revocado no estorba", async () => {
    expect(await codigo(crearNumero(A.id, ana))).toBe("23505");
    const viejo = await crearNumero(A.id, luis);
    await sys().update(schema.directNumber).set({ revokedAt: new Date() }).where(eq(schema.directNumber.id, viejo));
    expect(await codigo(crearNumero(A.id, luis))).toBeNull();
  });

  it("un chat por número: el de la empresa y el de cada «Mi número», con un solo contacto", async () => {
    const [numero] = await sys()
      .select()
      .from(schema.directNumber)
      .where(eq(schema.directNumber.userId, ana));
    const contacto = (await as(A.id, () => getOrCreateContact(A.id, "5215511110001", "Cliente"))).contact;
    // Primero el chat del número de Ana: no le quita su lugar al de la empresa.
    const personal = newId("conversation");
    await sys().insert(schema.conversation).values({
      id: personal,
      organizationId: A.id,
      contactId: contacto.id,
      directNumberId: numero!.id,
    });
    const empresa = await as(A.id, () => getOrCreateConversation(A.id, contacto.id));
    expect(empresa.id).not.toBe(personal);
    expect(empresa.directNumberId).toBeNull();
    // El segundo llamado regresa el MISMO chat de la empresa, nunca el personal.
    expect((await as(A.id, () => getOrCreateConversation(A.id, contacto.id))).id).toBe(empresa.id);
    // Un segundo chat del mismo número con el mismo cliente choca.
    const repetido = sys().insert(schema.conversation).values({
      id: newId("conversation"),
      organizationId: A.id,
      contactId: contacto.id,
      directNumberId: numero!.id,
    });
    expect(await codigo(repetido)).toBe("23505");
    const contactos = await sys().select().from(schema.contact).where(eq(schema.contact.organizationId, A.id));
    expect(contactos.filter((c) => c.phone === contacto.phone)).toHaveLength(1);
  });

  it("aislado por defecto: la Bandeja de hoy no ve ni abre el chat de un «Mi número»", async () => {
    const chats = await sys().select().from(schema.conversation).where(eq(schema.conversation.organizationId, A.id));
    const privado = chats.find((c) => c.directNumberId !== null)!;
    await sys().update(schema.conversation).set({ unreadCount: 3, lastMessageAt: new Date() }).where(eq(schema.conversation.id, privado.id));
    const access = { organizationId: A.id, userId: ana, seesAll: true };
    const lista = await as(A.id, () => listConversations(access));
    expect(lista.map((c) => c.id)).not.toContain(privado.id);
    expect(lista.some((c) => chats.some((x) => x.id === c.id && x.directNumberId === null))).toBe(true);
    expect(await as(A.id, () => getConversation(access, privado.id))).toBeNull();
    expect(await as(A.id, () => countUnread(access))).toBe(0);
  });

  it("una conexión de la empresa por organización y una por número; el código de hoy solo ve la de la empresa", async () => {
    const [numero] = await sys().select().from(schema.directNumber).where(eq(schema.directNumber.userId, ana));
    // La del número de Ana existe ANTES que la de la empresa.
    await sys().insert(schema.directConnection).values({
      id: newId("directConnection"),
      organizationId: A.id,
      serverId: servidor,
      instanceName: `ana-${A.id}`,
      directNumberId: numero!.id,
      status: "connected",
    });
    expect(await getConnection(A.id)).toBeNull();
    expect(await as(A.id, () => getDirectConnection(A.id))).toBeNull();
    // El alta de la empresa (ON CONFLICT con el índice parcial nuevo) funciona.
    expect(await assignServer(A.id, servidor, `empresa-${A.id}`)).toBe("assigned");
    expect(await assignServer(A.id, servidor, `empresa-${A.id}`)).toBe("assigned");
    const empresa = await getConnection(A.id);
    expect(empresa?.instanceName).toBe(`empresa-${A.id}`);
    expect(empresa?.directNumberId).toBeNull();
    expect((await as(A.id, () => getDirectConnection(A.id)))?.instanceName).toBe(`empresa-${A.id}`);
    // Una segunda de la empresa, o una segunda del mismo número, chocan.
    const otraEmpresa = sys().insert(schema.directConnection).values({
      id: newId("directConnection"),
      organizationId: A.id,
      serverId: servidor,
      instanceName: `empresa2-${A.id}`,
    });
    expect(await codigo(otraEmpresa)).toBe("23505");
    const otraAna = sys().insert(schema.directConnection).values({
      id: newId("directConnection"),
      organizationId: A.id,
      serverId: servidor,
      instanceName: `ana2-${A.id}`,
      directNumberId: numero!.id,
    });
    expect(await codigo(otraAna)).toBe("23505");
  });

  it("nada de A cuelga de un número de B", async () => {
    const numeroB = await crearNumero(B.id, luis);
    const contacto = (await as(A.id, () => getOrCreateContact(A.id, "5215511110002", "Otro"))).contact;
    const chat = sys().insert(schema.conversation).values({
      id: newId("conversation"),
      organizationId: A.id,
      contactId: contacto.id,
      directNumberId: numeroB,
    });
    expect(await codigo(chat)).toBe("23503");
    const privado = sys()
      .update(schema.contact)
      .set({ privateToNumberId: numeroB })
      .where(eq(schema.contact.id, contacto.id));
    expect(await codigo(privado)).toBe("23503");
    const conexion = sys().insert(schema.directConnection).values({
      id: newId("directConnection"),
      organizationId: A.id,
      serverId: servidor,
      instanceName: `cruzada-${A.id}`,
      directNumberId: numeroB,
    });
    expect(await codigo(conexion)).toBe("23503");
  });

  it("RLS: los números, solicitudes y bitácora de A no se ven desde B", async () => {
    const [chat] = await sys()
      .select()
      .from(schema.conversation)
      .where(eq(schema.conversation.organizationId, A.id));
    await sys().insert(schema.conversationAccess).values({
      id: newId("conversationAccess"),
      organizationId: A.id,
      conversationId: chat!.id,
      userId: luis,
    });
    await sys().insert(schema.conversationAccessLog).values({
      id: newId("conversationAccessLog"),
      organizationId: A.id,
      conversationId: chat!.id,
      userId: luis,
    });
    const desdeB = await withTenant(B.id, async (db) => ({
      numeros: await db.select().from(schema.directNumber),
      solicitudes: await db.select().from(schema.conversationAccess),
      bitacora: await db.select().from(schema.conversationAccessLog),
    }));
    expect(desdeB.numeros.every((n) => n.organizationId === B.id)).toBe(true);
    expect(desdeB.solicitudes).toEqual([]);
    expect(desdeB.bitacora).toEqual([]);
    // Una solicitud viva por persona y chat.
    const doble = sys().insert(schema.conversationAccess).values({
      id: newId("conversationAccess"),
      organizationId: A.id,
      conversationId: chat!.id,
      userId: luis,
    });
    expect(await codigo(doble)).toBe("23505");
  });

  it("«Mi número» requiere la conexión directa (servidor y BD)", async () => {
    await expect(updateOrgModules(A.id, { miNumero: true }, "prueba")).rejects.toThrow(/conexión directa/);
    await updateOrgModules(A.id, { conexionDirecta: true, miNumero: true, miNumeroMax: 5 }, "prueba");
    forgetOrgModules(A.id);
    expect(await getOrgModules(A.id)).toMatchObject({ miNumero: true, miNumeroMax: 5 });
    // Apagar la conexión directa apaga «Mi número».
    await updateOrgModules(A.id, { conexionDirecta: false }, "prueba");
    forgetOrgModules(A.id);
    expect((await getOrgModules(A.id)).miNumero).toBe(false);
    const mano = getSystemSql()`update organization_module set mi_numero = true, conexion_directa = false where organization_id = ${A.id}`;
    expect(await codigo(mano)).toBe("23514");
    const tope = getSystemSql()`update organization_module set mi_numero_max = 500 where organization_id = ${A.id}`;
    expect(await codigo(tope)).toBe("23514");
  });

  it("/platform (PR 2): «Mi número» sin conexión directa es 422; con ella guarda el tope y cuenta los números vivos", async () => {
    const actor = { userId: ana, email: "fer@plataforma.test" };
    await expect(changeOrganizationModules(B.id, { miNumero: true }, actor, null)).rejects.toMatchObject(
      new PlatformError(422, "module_dependency", "«Mi número» requiere la conexión directa: enciéndela primero")
    );
    const m = await changeOrganizationModules(B.id, { conexionDirecta: true, miNumero: true, miNumeroMax: 3 }, actor, null);
    expect(m).toMatchObject({ conexionDirecta: true, miNumero: true, miNumeroMax: 3 });
    // B tiene un número vivo (el de Luis, de la prueba de FK); uno revocado no cuenta.
    const revocado = await crearNumero(B.id, ana);
    await sys().update(schema.directNumber).set({ revokedAt: new Date() }).where(eq(schema.directNumber.id, revocado));
    expect((await organizationDirect(B.id)).numbersInUse).toBe(1);
    const bitacora = await getSystemSql()<{ detail: Record<string, unknown> }[]>`
      select detail from platform_audit_log where target_org_id = ${B.id} and action = 'organization.modules_changed'
      order by at desc limit 1`;
    expect(bitacora[0]?.detail).toMatchObject({ miNumero: { de: false, a: true }, miNumeroMax: { de: 0, a: 3 } });
  });

  it("borrar la organización borra números, chats, conexiones y contactos privados juntos", async () => {
    const extra = await crearOrganizacion("MiNumero borrar");
    const numero = await crearNumero(extra.id, ana);
    const contacto = (await as(extra.id, () => getOrCreateContact(extra.id, "5215511110003", "Mamá"))).contact;
    await sys().update(schema.contact).set({ privateToNumberId: numero }).where(eq(schema.contact.id, contacto.id));
    await sys().insert(schema.conversation).values({
      id: newId("conversation"),
      organizationId: extra.id,
      contactId: contacto.id,
      directNumberId: numero,
    });
    await borrarOrganizaciones([extra.id]);
    const [n] = await getSystemSql()<{ n: number }[]>`
      select count(*)::int as n from "direct_number" where organization_id = ${extra.id}`;
    expect(n!.n).toBe(0);
  });
});
