import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scopedContacts, scopedMediaAssets, type Access } from "@/lib/db/tenant";
import type { DeviceMessage } from "@/lib/direct-inbound";
import { runWithOrganization } from "@/lib/request-context";
import { audienceContacts } from "@/server/campaigns/audience";
import { canSeeEvent } from "@/server/events/visibility";
import { getOrCreateContact } from "@/server/inbox/ingest";
import { listConversations, listMessages } from "@/server/inbox/queries";
import { listMyChats, markClient, myChatMessages, myNumberAsset } from "@/server/mi-numero/chats";
import { ingestNumberMessages } from "@/server/mi-numero/inbound";
import { MiNumeroFailure } from "@/server/mi-numero/numbers";
import { forgetOrgModules } from "@/server/modules";
import { updateOrgModules } from "@/server/modules/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Mi número (046), PR 4 — Lo que entra por el «Mi número» de una persona,
 * contra Postgres real (la app como `vocero_app`, con RLS):
 *
 * - Va al chat de ESE número; un contacto nuevo nace privado (fuera del CRM)
 *   y uno que ya existe se usa (una sola ficha).
 * - Aislado: ni la Bandeja, ni Contactos, ni las campañas, ni los mensajes y
 *   adjuntos por los filtros de siempre, ni los eventos en vivo, aunque se
 *   vea todo. Solo su dueño.
 * - Un privado que escribe a la empresa pasa al CRM; «Es cliente» también
 *   (solo con «Compartir mis clientes» encendido).
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const sys = () => getSystemDb();
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

async function falla(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    if (err instanceof MiNumeroFailure) return err.code;
    throw err;
  }
}

async function crearMiembro(organizationId: string, name: string, role = "asesor"): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@x.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId, userId: id, role });
  return id;
}

let seq = 0;
function msg(phone: string, text: string, opts: { fromMe?: boolean; keyId?: string; image?: boolean } = {}): DeviceMessage {
  const keyId = opts.keyId ?? `KEY${++seq}${Date.now()}`;
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    keyId,
    fromMe: opts.fromMe ?? false,
    phone,
    lid: null,
    pushName: opts.fromMe ? null : "Cliente",
    timestamp: ts,
    message: (opts.image
      ? { type: "image", image: { id: `direct:${keyId}`, mime_type: "image/jpeg" }, id: `direct.${keyId}`, timestamp: ts }
      : { type: "text", text: { body: text }, id: `direct.${keyId}`, timestamp: ts, ...(opts.fromMe ? { to: phone } : { from: phone }) }) as DeviceMessage["message"],
  };
}

describe("Mi número — lo que entra a cada número (PR 4)", () => {
  let A: Org;
  let fer: string;
  let ana: string;
  let luis: string;
  let numAna: string;
  let todo: Access;
  let comoAna: Access;

  beforeAll(async () => {
    A = await crearOrganizacion("MiNumero entrada A");
    fer = await crearMiembro(A.id, "Fer", "owner");
    ana = await crearMiembro(A.id, "Ana");
    luis = await crearMiembro(A.id, "Luis");
    await updateOrgModules(A.id, { conexionDirecta: true, miNumero: true, miNumeroMax: 3 }, "prueba");
    forgetOrgModules(A.id);
    numAna = newId("directNumber");
    await sys().insert(schema.directNumber).values({ id: numAna, organizationId: A.id, userId: ana, noticeAcceptedAt: new Date() });
    todo = { organizationId: A.id, userId: fer, seesAll: true };
    comoAna = { organizationId: A.id, userId: ana, seesAll: false };
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
    await sys().delete(schema.user).where(inArray(schema.user.id, [fer, ana, luis]));
  });

  const ref = () => ({ organizationId: A.id, directNumberId: numAna });

  it("un desconocido que le escribe a Ana: contacto privado, chat de SU número, sin lead", async () => {
    expect(await ingestNumberMessages(ref(), [msg("52552222001", "hola Ana"), msg("52552222001", "¿sigues?")])).toBe(2);
    const [contacto] = await sys().select().from(schema.contact).where(eq(schema.contact.waIdentity, "52552222001"));
    expect(contacto).toMatchObject({ privateToNumberId: numAna, assignedUserId: null });
    const chats = await sys().select().from(schema.conversation).where(eq(schema.conversation.contactId, contacto!.id));
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ directNumberId: numAna, unreadCount: 2, aiEnabled: false });
    const leads = await sys().select().from(schema.lead).where(eq(schema.lead.contactId, contacto!.id));
    expect(leads).toHaveLength(0);
    const mios = await as(A.id, () => listMyChats(A.id, ana));
    expect(mios.chats).toHaveLength(1);
    expect(mios.chats[0]).toMatchObject({ unreadCount: 2, preview: "¿sigues?", contact: { inCrm: false } });
  });

  it("idempotente, y el mismo key.id en la empresa y en el número son dos mensajes", async () => {
    const m = msg("52552222001", "repetido", { keyId: "MISMOKEY1" });
    expect(await ingestNumberMessages(ref(), [m])).toBe(1);
    expect(await ingestNumberMessages(ref(), [m])).toBe(0);
    const ids = await sys().select({ id: schema.message.waMessageId }).from(schema.message).where(eq(schema.message.altMessageId, "MISMOKEY1"));
    expect(ids.map((r) => r.id)).toEqual([`direct.${numAna}.MISMOKEY1`]);
  });

  it("aislado: ni la Bandeja, ni Contactos, ni campañas, ni mensajes, aunque se vea todo", async () => {
    const [contacto] = await sys().select().from(schema.contact).where(eq(schema.contact.waIdentity, "52552222001"));
    const [chat] = await sys().select().from(schema.conversation).where(eq(schema.conversation.contactId, contacto!.id));
    await sys().update(schema.contact).set({ waConsent: "opt_in" }).where(eq(schema.contact.id, contacto!.id));
    for (const access of [todo, comoAna]) {
      const bandeja = await as(A.id, () => listConversations(access));
      expect(bandeja.find((c) => c.id === chat!.id)).toBeUndefined();
      const contactos = await as(A.id, () =>
        getDb().select({ id: schema.contact.id }).from(schema.contact).where(scopedContacts(schema.contact.organizationId, access, schema.contact.id))
      );
      expect(contactos.find((c) => c.id === contacto!.id)).toBeUndefined();
      expect(await as(A.id, () => listMessages(access, chat!.id))).toEqual([]);
    }
    const publico = await as(A.id, () => audienceContacts(A.id, {}));
    expect(publico.find((c) => c.id === contacto!.id)).toBeUndefined();
    // Los eventos en vivo: solo a su dueño, ni a quien ve todo.
    const evento = { type: "number.message" as const, data: { conversationId: chat!.id, message: {} }, audience: [ana] };
    expect(await as(A.id, () => canSeeEvent(comoAna, evento))).toBe(true);
    expect(await as(A.id, () => canSeeEvent(todo, evento))).toBe(false);
  });

  it("solo su dueño abre sus chats; abrirlo los deja leídos", async () => {
    const [chat] = (await as(A.id, () => listMyChats(A.id, ana))).chats;
    expect(await falla(as(A.id, () => myChatMessages(A.id, luis, chat!.id)))).toBe("not_found");
    const mensajes = await as(A.id, () => myChatMessages(A.id, ana, chat!.id));
    expect(mensajes.map((m) => m.text)).toEqual(["hola Ana", "¿sigues?", "repetido"]);
    expect((await as(A.id, () => listMyChats(A.id, ana))).chats[0]!.unreadCount).toBe(0);
  });

  it("lo que Ana escribe en su celular entra como suyo, sin sumar no leídos", async () => {
    await ingestNumberMessages(ref(), [msg("52552222001", "ya voy", { fromMe: true })]);
    const [chat] = (await as(A.id, () => listMyChats(A.id, ana))).chats;
    expect(chat).toMatchObject({ unreadCount: 0, preview: "ya voy" });
    const ultimo = (await as(A.id, () => myChatMessages(A.id, ana, chat!.id))).at(-1);
    expect(ultimo).toMatchObject({ direction: "out", origin: "manual" });
  });

  it("un cliente del CRM que le escribe a Ana: la misma ficha, otro chat, y sigue en el CRM", async () => {
    const { contact } = await as(A.id, () => getOrCreateContact(A.id, "52552222002", "Cliente CRM"));
    await ingestNumberMessages(ref(), [msg("52552222002", "hola desde mi cel")]);
    const contactos = await sys().select().from(schema.contact).where(eq(schema.contact.waIdentity, "52552222002"));
    expect(contactos).toHaveLength(1);
    expect(contactos[0]!.privateToNumberId).toBeNull();
    const chats = await sys().select().from(schema.conversation).where(eq(schema.conversation.contactId, contact.id));
    expect(chats.map((c) => c.directNumberId)).toEqual([numAna]);
  });

  it("un privado que le escribe a la empresa pasa al CRM (su chat con Ana sigue privado)", async () => {
    await ingestNumberMessages(ref(), [msg("52552222003", "soy privado")]);
    const { contact } = await as(A.id, () => getOrCreateContact(A.id, "52552222003"));
    expect(contact.privateToNumberId).toBeNull();
    const bandeja = await as(A.id, () => listConversations(todo));
    expect(bandeja.filter((c) => c.contact.id === contact.id)).toHaveLength(0);
  });

  it("«Es cliente»: solo con «Compartir mis clientes»; pasa al CRM, asignado a Ana y con lead", async () => {
    await ingestNumberMessages(ref(), [msg("52552222004", "quiero cotizar")]);
    const chat = (await as(A.id, () => listMyChats(A.id, ana))).chats.find((c) => c.contact.phone === "52552222004")!;
    expect(await falla(as(A.id, () => markClient(A.id, ana, chat.id)))).toBe("share_off");
    await sys().update(schema.directNumber).set({ shareClients: true }).where(eq(schema.directNumber.id, numAna));
    expect(await falla(as(A.id, () => markClient(A.id, luis, chat.id)))).toBe("not_found");
    await as(A.id, () => markClient(A.id, ana, chat.id));
    const [contacto] = await sys().select().from(schema.contact).where(eq(schema.contact.id, chat.contact.id));
    expect(contacto).toMatchObject({ privateToNumberId: null, assignedUserId: ana });
    expect(await sys().select().from(schema.lead).where(eq(schema.lead.contactId, contacto!.id))).toHaveLength(1);
    const otraVez = (await as(A.id, () => listMyChats(A.id, ana))).chats.find((c) => c.id === chat.id)!;
    expect(otraVez.clientMarkedAt).not.toBeNull();
    expect(otraVez.contact.inCrm).toBe(true);
    // Ahora Ana lo ve en Contactos (asignado), pero el chat sigue fuera de la Bandeja de la empresa.
    const contactos = await as(A.id, () =>
      getDb().select({ id: schema.contact.id }).from(schema.contact).where(scopedContacts(schema.contact.organizationId, comoAna, schema.contact.id))
    );
    expect(contactos.map((c) => c.id)).toContain(contacto!.id);
    expect((await as(A.id, () => listConversations(todo))).find((c) => c.id === chat.id)).toBeUndefined();
  });

  it("un adjunto: se guarda con el número; solo su dueño lo abre", async () => {
    await ingestNumberMessages(ref(), [msg("52552222001", "", { image: true, keyId: "IMGKEY1" })]);
    const [asset] = await sys().select().from(schema.mediaAsset).where(eq(schema.mediaAsset.waMediaId, `dnum:${numAna}:IMGKEY1`));
    expect(asset).toBeTruthy();
    const porFiltro = await as(A.id, () =>
      getDb().select({ id: schema.mediaAsset.id }).from(schema.mediaAsset).where(scopedMediaAssets(schema.mediaAsset.organizationId, todo, schema.mediaAsset.id, eq(schema.mediaAsset.id, asset!.id)))
    );
    expect(porFiltro).toEqual([]);
    expect((await as(A.id, () => myNumberAsset(A.id, ana, asset!.id)))?.id).toBe(asset!.id);
    expect(await as(A.id, () => myNumberAsset(A.id, luis, asset!.id))).toBeNull();
  });

  it("un número revocado o con el complemento apagado no recibe nada", async () => {
    await sys().update(schema.directNumber).set({ revokedAt: new Date() }).where(eq(schema.directNumber.id, numAna));
    expect(await ingestNumberMessages(ref(), [msg("52552222009", "¿hola?")])).toBe(0);
    await sys().update(schema.directNumber).set({ revokedAt: null }).where(eq(schema.directNumber.id, numAna));
    await updateOrgModules(A.id, { miNumero: false }, "prueba");
    forgetOrgModules(A.id);
    expect(await ingestNumberMessages(ref(), [msg("52552222009", "¿hola?")])).toBe(0);
    expect(await sys().select().from(schema.contact).where(eq(schema.contact.waIdentity, "52552222009"))).toHaveLength(0);
  });
});
