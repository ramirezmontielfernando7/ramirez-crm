import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getSystemDb as getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { DEMO_AGENT_NAME } from "@/lib/demo";
import { hasDemo, removeDemo, seedDemo } from "@/server/seed/demo";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Auditoría UX 2026-11 (punto 6) — «Quitar ejemplo» borra SOLO lo de la demo
 * y SOLO de su organización: lo que la persona agregó y la otra empresa
 * quedan igual.
 */
describe("quitar los datos de ejemplo", () => {
  let A: { id: string };
  let B: { id: string };

  beforeAll(async () => {
    A = await crearOrganizacion("Ejemplo A");
    B = await crearOrganizacion("Ejemplo B");
    await seedDemo(getDb(), A.id);
    await seedDemo(getDb(), B.id);
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });

  it("quita la demo de A y deja lo propio de A y toda la demo de B", async () => {
    const db = getDb();
    const propio = newId("contact");
    await db.insert(schema.contact).values({
      id: propio,
      organizationId: A.id,
      waIdentity: "525598765432",
      phone: "525598765432",
      name: "Cliente real",
    });
    await db.insert(schema.kbEntry).values({
      id: newId("kbEntry"),
      organizationId: A.id,
      kind: "qa",
      question: "¿Abren en domingo?",
      answer: "Sí, de 10 a 2.",
    });
    expect(await hasDemo(db, A.id)).toBe(true);

    const r = await db.transaction((tx) => removeDemo(tx, A.id));
    expect(r.contacts).toBeGreaterThan(0);

    expect(await hasDemo(db, A.id)).toBe(false);
    const contactosA = await db.select().from(schema.contact).where(eq(schema.contact.organizationId, A.id));
    expect(contactosA.map((c) => c.id)).toEqual([propio]);
    const kbA = await db.select().from(schema.kbEntry).where(eq(schema.kbEntry.organizationId, A.id));
    expect(kbA.map((k) => k.question)).toEqual(["¿Abren en domingo?"]);
    const [perfilA] = await db.select().from(schema.agentProfile).where(eq(schema.agentProfile.organizationId, A.id));
    expect(perfilA?.name).not.toBe(DEMO_AGENT_NAME);
    expect(perfilA?.instructions ?? null).toBeNull();

    expect(await hasDemo(db, B.id)).toBe(true);
    const [perfilB] = await db
      .select()
      .from(schema.agentProfile)
      .where(and(eq(schema.agentProfile.organizationId, B.id)));
    expect(perfilB?.name).toBe(DEMO_AGENT_NAME);
  });
});
