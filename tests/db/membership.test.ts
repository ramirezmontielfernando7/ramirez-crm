import { afterAll, beforeAll, describe, expect, it } from "vitest";
// PR 3: la prueba prepara y revisa como PLATAFORMA (pool de sistema); lo que
// prueba (ingesta, llaves, membresía) elige su pool por su cuenta.
import { eq } from "drizzle-orm";
import { getSystemDb as getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resolveMembership } from "@/server/auth/on-signup";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * H4 — La organización de una sesión sale de UNA fuente determinista: la
 * activa de la sesión (validada contra `member`) o, si no, la membresía más
 * antigua. Con un usuario de dos membresías (no debería pasar, pero la BD lo
 * permite) el resultado no depende del orden físico de las filas.
 */
describe("resolveMembership", () => {
  let A: { id: string };
  let B: { id: string };
  let C: { id: string };
  const userId = newId("member").replace("mem", "usr");

  beforeAll(async () => {
    const db = getDb();
    A = await crearOrganizacion("Membresia A");
    B = await crearOrganizacion("Membresia B");
    C = await crearOrganizacion("Membresia C");
    await db.insert(schema.user).values({
      id: userId,
      name: "Dos membresías",
      email: `${userId}@vocero.test`,
      emailVerified: false,
    });
    // B se inserta PRIMERO (queda antes en disco) pero es la más NUEVA.
    await db.insert(schema.member).values({
      id: newId("member"),
      organizationId: B.id,
      userId,
      role: "asesor",
      createdAt: new Date("2026-09-02T00:00:00Z"),
    });
    await db.insert(schema.member).values({
      id: newId("member"),
      organizationId: A.id,
      userId,
      role: "coordinador",
      createdAt: new Date("2026-09-01T00:00:00Z"),
    });
  });
  afterAll(async () => {
    await getDb().delete(schema.user).where(eq(schema.user.id, userId));
    await borrarOrganizaciones([A.id, B.id, C.id]);
  });

  it("sin organización activa: la membresía más antigua, no la primera en disco", async () => {
    expect(await resolveMembership(userId)).toEqual({ organizationId: A.id, role: "coordinador" });
    expect(await resolveMembership(userId, null)).toEqual({ organizationId: A.id, role: "coordinador" });
  });

  it("con organización activa de la que es miembro: esa, con su rol", async () => {
    expect(await resolveMembership(userId, B.id)).toEqual({ organizationId: B.id, role: "asesor" });
  });

  it("con una organización activa de la que NO es miembro: se ignora", async () => {
    expect(await resolveMembership(userId, C.id)).toEqual({ organizationId: A.id, role: "coordinador" });
  });

  it("sin ninguna membresía: null (la sesión queda en 401)", async () => {
    expect(await resolveMembership("usr_no_existe", A.id)).toBeNull();
  });
});
