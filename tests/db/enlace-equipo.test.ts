import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { createTeamLink, inspectAccountLink } from "@/server/platform-admin/links";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Auditoría UX 2026-11 (13) — El Propietario da un enlace para entrar a
 * alguien de SU equipo, pero nunca a una cuenta que también está en otra
 * empresa (el correo es único en toda la instancia).
 */
describe("enlace para entrar del equipo", () => {
  let A: { id: string };
  let B: { id: string };
  const soloA = newId("user");
  const enAyB = newId("user");
  const soloB = newId("user");

  beforeAll(async () => {
    A = await crearOrganizacion("Enlace A");
    B = await crearOrganizacion("Enlace B");
    const db = getSystemDb();
    const sufijo = Math.random().toString(36).slice(2, 8);
    await db.insert(schema.user).values(
      [soloA, enAyB, soloB].map((id, i) => ({ id, name: `Persona ${i}`, email: `p${i}-${sufijo}@enlace.test` }))
    );
    await db.insert(schema.member).values([
      { id: newId("member"), organizationId: A.id, userId: soloA, role: "asesor" },
      { id: newId("member"), organizationId: A.id, userId: enAyB, role: "asesor" },
      { id: newId("member"), organizationId: B.id, userId: enAyB, role: "asesor" },
      { id: newId("member"), organizationId: B.id, userId: soloB, role: "asesor" },
    ]);
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
    await getSystemDb().delete(schema.user).where(inArray(schema.user.id, [soloA, enAyB, soloB]));
  });

  it("da un enlace de activación de 72 h a quien solo está en la empresa", async () => {
    const r = await createTeamLink(A.id, soloA, soloA);
    expect("url" in r).toBe(true);
    if (!("url" in r)) return;
    expect(r.url).toMatch(/\/activar\//);
    expect(r.expiresAt.getTime() - Date.now()).toBeGreaterThan(71 * 60 * 60 * 1000);
    const info = await inspectAccountLink(r.url.split("/").pop()!);
    expect(info.ok && info.purpose).toBe("activate");
  });

  it("no da enlace a quien también está en otra empresa ni a quien no es del equipo", async () => {
    expect(await createTeamLink(A.id, enAyB, soloA)).toEqual({ error: "other_org" });
    expect(await createTeamLink(A.id, soloB, soloA)).toEqual({ error: "not_member" });
  });
});
