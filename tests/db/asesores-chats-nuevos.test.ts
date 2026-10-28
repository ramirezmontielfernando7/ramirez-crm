import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { sessionContext } from "@/lib/auth/session";
import { openChat, registerContact, sendFirstTemplate } from "@/server/inbox/new-number";
import {
  getAdvisorNewChatsBlocked,
  setAdvisorNewChatsBlocked,
} from "@/server/messaging-settings";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 048 — «Chats nuevos de los asesores» contra Postgres real: apagado por
 * defecto, con el interruptor encendido un Asesor no abre chats ni registra
 * contactos nuevos (pero sí atiende el que ya tiene), y Propietario y
 * Coordinador no tienen la restricción.
 */
describe("chats nuevos de los asesores", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let owner: string;
  let asesor: string;
  const inA = <T>(fn: () => Promise<T>) => runWithOrganization(A.id, fn);
  const asesorS = () => sessionContext(asesor, A.id, "asesor");
  const coordS = () => sessionContext(owner, A.id, "coordinador");
  const ownerS = () => sessionContext(owner, A.id, "owner");

  beforeAll(async () => {
    A = await crearOrganizacion("Bloqueo A");
    const sys = getSystemDb();
    const mk = async (role: string) => {
      const id = newId("user");
      await sys.insert(schema.user).values({ id, name: role, email: `${id}@x.test`, emailVerified: true });
      await sys.insert(schema.member).values({ id: newId("member"), organizationId: A.id, userId: id, role });
      return id;
    };
    owner = await mk("owner");
    asesor = await mk("asesor");
  });

  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
    const sys = getSystemDb();
    for (const id of [owner, asesor]) await sys.delete(schema.user).where(eq(schema.user.id, id));
  });

  it("apagado por defecto: el asesor abre chats como siempre", async () => {
    expect(await inA(() => getAdvisorNewChatsBlocked(A.id))).toBe(false);
    const r = await inA(() => openChat(asesorS(), "5560000001"));
    expect(r.created).toBe(true);
  });

  it("encendido: el asesor no abre, no registra ni escribe primero a un contacto nuevo", async () => {
    await inA(() => setAdvisorNewChatsBlocked(A.id, true, owner));
    expect(await inA(() => getAdvisorNewChatsBlocked(A.id))).toBe(true);
    await expect(inA(() => openChat(asesorS(), "5560000002"))).rejects.toMatchObject({
      code: "new_chats_blocked",
      status: 403,
    });
    await expect(inA(() => registerContact(asesorS(), { phone: "5560000002" }))).rejects.toMatchObject({
      code: "new_chats_blocked",
    });
    await expect(
      inA(() =>
        sendFirstTemplate(asesorS(), { phone: "5560000002", templateId: "tpl_x", consent: "yes" })
      )
    ).rejects.toMatchObject({ code: "new_chats_blocked" });
  });

  it("encendido: el asesor SÍ atiende el chat que ya tiene", async () => {
    const again = await inA(() => openChat(asesorS(), "5560000001"));
    expect(again.created).toBe(false);
  });

  it("encendido: Coordinador y Propietario no tienen la restricción", async () => {
    expect((await inA(() => openChat(coordS(), "5560000003"))).created).toBe(true);
    expect((await inA(() => openChat(ownerS(), "5560000004"))).created).toBe(true);
  });

  it("al apagarlo, el asesor vuelve a abrir chats", async () => {
    await inA(() => setAdvisorNewChatsBlocked(A.id, false, owner));
    expect((await inA(() => openChat(asesorS(), "5560000005"))).created).toBe(true);
  });
});
