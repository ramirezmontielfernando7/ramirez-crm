import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { setAssignmentMode } from "@/server/assignment/settings";
import { strategyFor } from "@/server/assignment/strategy";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/** Reparto por turnos: uno tras otro entre los asesores, también en paralelo. */
type Org = Awaited<ReturnType<typeof crearOrganizacion>>;

describe("reparto por turnos", () => {
  let A: Org;
  const asesores = [newId("user"), newId("user"), newId("user")];
  const contactos: string[] = [];

  beforeAll(async () => {
    A = await crearOrganizacion("Turnos A");
    const sys = getSystemDb();
    for (const [i, id] of asesores.entries()) {
      await sys.insert(schema.user).values({ id, name: `Asesor ${i}`, email: `${id}@x.test`, emailVerified: true });
      await sys.insert(schema.member).values({
        id: newId("member"),
        organizationId: A.id,
        userId: id,
        role: "asesor",
        createdAt: new Date(Date.now() + i * 1000),
      });
    }
    await runWithOrganization(A.id, async () => {
      for (let i = 0; i < 6; i++) {
        const id = newId("contact");
        contactos.push(id);
        await getDb().insert(schema.contact).values({ id, organizationId: A.id, waIdentity: `5255${i}${Date.now()}`, name: `C${i}` });
      }
    });
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
  });

  const pick = (c: string) =>
    runWithOrganization(A.id, async () => (await strategyFor(A.id)).pick({ organizationId: A.id, contactId: c }));

  it("a mano no reparte a nadie", async () => {
    expect(await pick(contactos[0]!)).toBeNull();
  });

  it("por turnos recorre a los asesores en orden y da la vuelta", async () => {
    await runWithOrganization(A.id, () => setAssignmentMode(A.id, "round_robin"));
    const got: (string | null)[] = [];
    for (const c of contactos.slice(0, 4)) got.push(await pick(c));
    expect(got).toEqual([asesores[0], asesores[1], asesores[2], asesores[0]]);
  });

  it("dos leads a la vez no caen en la misma persona", async () => {
    const [x, y] = await Promise.all([pick(contactos[4]!), pick(contactos[5]!)]);
    expect(x).not.toEqual(y);
  });
});
