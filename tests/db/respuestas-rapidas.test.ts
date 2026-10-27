import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { createQuickReply, deleteQuickReply, listQuickReplies, updateQuickReply } from "@/server/quick-replies/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Respuestas rápidas (migración 0059) contra Postgres real: cada organización
 * ve y cambia solo las suyas, y el atajo no se repite dentro de una.
 */
type Org = Awaited<ReturnType<typeof crearOrganizacion>> & { ownerId: string };
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

describe("respuestas rápidas", () => {
  let A: Org;
  let B: Org;
  async function conDueno(nombre: string): Promise<Org> {
    const org = await crearOrganizacion(nombre);
    const ownerId = newId("user");
    await getSystemDb().insert(schema.user).values({ id: ownerId, name: nombre, email: `${ownerId}@x.test`, emailVerified: true });
    await getSystemDb().insert(schema.member).values({ id: newId("member"), organizationId: org.id, userId: ownerId, role: "owner" });
    return { ...org, ownerId };
  }
  beforeAll(async () => {
    A = await conDueno("Rapidas A");
    B = await conDueno("Rapidas B");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
    await getSystemDb().delete(schema.user).where(inArray(schema.user.id, [A.ownerId, B.ownerId]));
  });

  it("crear, listar en orden, editar y borrar", async () => {
    const precios = await as(A.id, () => createQuickReply(A.id, A.ownerId, { shortcut: "precios", body: "Hola {nombre}, te paso precios" }));
    expect(precios).toMatchObject({ shortcut: "precios" });
    await as(A.id, () => createQuickReply(A.id, A.ownerId, { shortcut: "cuenta", body: "CLABE 1234" }));
    expect((await as(A.id, () => listQuickReplies(A.id))).map((r) => r.shortcut)).toEqual(["cuenta", "precios"]);
    const id = (precios as { id: string }).id;
    expect(await as(A.id, () => updateQuickReply(A.id, id, { body: "Nuevos precios" }))).toMatchObject({ body: "Nuevos precios" });
    expect(await as(A.id, () => deleteQuickReply(A.id, id))).toBe(true);
    expect((await as(A.id, () => listQuickReplies(A.id))).map((r) => r.shortcut)).toEqual(["cuenta"]);
  });

  it("el atajo no se repite en la organización (sí entre organizaciones)", async () => {
    expect(await as(A.id, () => createQuickReply(A.id, A.ownerId, { shortcut: "cuenta", body: "otra" }))).toBe("duplicate");
    expect(await as(B.id, () => createQuickReply(B.id, B.ownerId, { shortcut: "cuenta", body: "la de B" }))).toMatchObject({ shortcut: "cuenta" });
    const [deA] = await as(A.id, () => listQuickReplies(A.id));
    expect(await as(A.id, () => createQuickReply(A.id, A.ownerId, { shortcut: "horario", body: "9 a 6" }))).toMatchObject({ shortcut: "horario" });
    const horario = (await as(A.id, () => listQuickReplies(A.id))).find((r) => r.shortcut === "horario")!;
    expect(await as(A.id, () => updateQuickReply(A.id, horario.id, { shortcut: "cuenta" }))).toBe("duplicate");
    expect(deA!.body).toBe("CLABE 1234");
  });

  it("aisladas: B no ve, ni cambia, ni borra las de A", async () => {
    const [deA] = await as(A.id, () => listQuickReplies(A.id));
    expect((await as(B.id, () => listQuickReplies(B.id))).map((r) => r.body)).toEqual(["la de B"]);
    expect(await as(B.id, () => updateQuickReply(B.id, deA!.id, { body: "hackeado" }))).toBeNull();
    expect(await as(B.id, () => deleteQuickReply(B.id, deA!.id))).toBe(false);
    expect((await as(A.id, () => listQuickReplies(A.id))).find((r) => r.id === deA!.id)?.body).toBe("CLABE 1234");
  });
});
