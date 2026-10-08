import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { buildXlsx } from "@/server/contacts-io/xlsx-write";
import { importAudienceFile } from "@/server/campaigns/audiences";
import { TagError } from "@/server/tags/tags";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Etiqueta opcional «para todos los contactos de esta base» (Audiencias)
 * contra Postgres real: se SUMA a la automática y a las de cada fila, no
 * duplica contactos ni etiquetas, no toca filas inválidas o duplicadas y
 * respeta el aislamiento entre organizaciones.
 */
describe("etiqueta extra al importar una base", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let B: Awaited<ReturnType<typeof crearOrganizacion>>;
  let userId: string;

  beforeAll(async () => {
    A = await crearOrganizacion("EtiqImp A");
    B = await crearOrganizacion("EtiqImp B");
    userId = newId("user");
    await getSystemDb()
      .insert(schema.user)
      .values({ id: userId, name: "Dueña", email: `${userId}@x.test`, emailVerified: true });
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, userId));
  });

  const base = [
    ["Nombre", "Teléfono", "Etiquetas"],
    ["Ana", "5214621000001", "VIP"],
    ["Beto", "5214621000002", ""],
    ["Mal", "123", ""],
    ["Ana repetida", "5214621000001", ""],
  ];

  function importar(org: string, file: string, extraTag: Parameters<typeof importAudienceFile>[0]["extraTag"], rows = base) {
    return runWithOrganization(org, () =>
      importAudienceFile({
        organizationId: org,
        userId,
        fileName: file,
        bytes: buildXlsx("Base", rows),
        mapping: { name: 0, phone: 1, tags: 2 },
        consentAnswer: "yes",
        extraTag,
      })
    );
  }

  async function tagsOf(org: string, waIdentity: string): Promise<string[]> {
    return runWithOrganization(org, async () => {
      const rows = await getDb()
        .select({ name: schema.contactTag.name })
        .from(schema.contact)
        .innerJoin(schema.contactTagAssignment, eq(schema.contactTagAssignment.contactId, schema.contact.id))
        .innerJoin(schema.contactTag, eq(schema.contactTag.id, schema.contactTagAssignment.tagId))
        .where(and(eq(schema.contact.organizationId, org), eq(schema.contact.waIdentity, waIdentity)));
      return rows.map((r) => r.name).sort();
    });
  }

  it("contactos nuevos: automática + las de su fila + la nueva (con color)", async () => {
    const { summary, audience } = await importar(A.id, "admon.xlsx", { kind: "new", name: "Referido", color: "verde" });
    expect(summary.extraTag?.name).toBe("Referido");
    // La automática sigue siendo la de la audiencia.
    expect(audience.tag?.name).toBe("Import: admon.xlsx");
    expect(await tagsOf(A.id, "524621000001")).toEqual(["Import: admon.xlsx", "Referido", "VIP"]);
    expect(await tagsOf(A.id, "524621000002")).toEqual(["Import: admon.xlsx", "Referido"]);
    const created = await runWithOrganization(A.id, () =>
      getDb().select().from(schema.contactTag).where(and(eq(schema.contactTag.organizationId, A.id), eq(schema.contactTag.name, "Referido")))
    );
    expect(created[0]?.color).toBe("verde");
  });

  it("filas inválidas y duplicadas no reciben etiqueta ni crean contacto", async () => {
    const rows = await runWithOrganization(A.id, () =>
      getDb().select().from(schema.contact).where(eq(schema.contact.organizationId, A.id))
    );
    // Solo Ana y Beto existen: la inválida no entró y la repetida no duplicó a Ana.
    expect(rows.map((c) => c.waIdentity).sort()).toEqual(["524621000001", "524621000002"]);
    expect(await tagsOf(A.id, "123")).toEqual([]);
  });

  it("contacto existente: solo se le agrega la etiqueta; no pierde datos ni etiquetas y no se duplica", async () => {
    const id = newId("contact");
    const tagId = newId("contactTag");
    await runWithOrganization(A.id, async () => {
      await getDb().insert(schema.contact).values({
        id, organizationId: A.id, waIdentity: "524621000009", phone: "524621000009",
        name: "Ya estaba", email: "ya@x.mx", waConsent: "opt_in",
      });
      await getDb().insert(schema.contactTag).values({ id: tagId, organizationId: A.id, name: "Previa" });
      await getDb().insert(schema.contactTagAssignment).values({ organizationId: A.id, contactId: id, tagId });
    });
    const existente = await runWithOrganization(A.id, () =>
      getDb().select().from(schema.contactTag).where(and(eq(schema.contactTag.organizationId, A.id), eq(schema.contactTag.name, "Referido")))
    );
    await importar(A.id, "otra.xlsx", { kind: "existing", id: existente[0]!.id }, [
      ["Nombre", "Teléfono", "Etiquetas"],
      ["Otro nombre", "5214621000009", "Zona"],
    ]);
    expect(await tagsOf(A.id, "524621000009")).toEqual(["Import: otra.xlsx", "Previa", "Referido", "Zona"]);
    const [c] = await runWithOrganization(A.id, () =>
      getDb().select().from(schema.contact).where(and(eq(schema.contact.organizationId, A.id), eq(schema.contact.waIdentity, "524621000009")))
    );
    expect(c).toMatchObject({ id, name: "Ya estaba", email: "ya@x.mx" });
  });

  it("etiqueta repetida: reimportar con la misma no duplica asignaciones", async () => {
    const existente = await runWithOrganization(A.id, () =>
      getDb().select().from(schema.contactTag).where(and(eq(schema.contactTag.organizationId, A.id), eq(schema.contactTag.name, "Referido")))
    );
    await importar(A.id, "admon.xlsx", { kind: "existing", id: existente[0]!.id });
    expect(await tagsOf(A.id, "524621000001")).toEqual(["Import: admon.xlsx", "Referido", "VIP"]);
  });

  it("sin etiqueta extra todo queda como hoy", async () => {
    const { summary } = await importar(A.id, "sola.xlsx", null, [
      ["Nombre", "Teléfono", "Etiquetas"],
      ["Carla", "5214621000003", ""],
    ]);
    expect(summary.extraTag).toBeNull();
    expect(await tagsOf(A.id, "524621000003")).toEqual(["Import: sola.xlsx"]);
  });

  it("crear una etiqueta con un nombre que ya existe: 409 y no se importa nada", async () => {
    await expect(
      importar(A.id, "dup.xlsx", { kind: "new", name: "Referido", color: null }, [
        ["Nombre", "Teléfono", "Etiquetas"],
        ["Dora", "5214621000004", ""],
      ])
    ).rejects.toMatchObject({ code: "duplicate" });
    expect(await tagsOf(A.id, "524621000004")).toEqual([]);
    const aud = await runWithOrganization(A.id, () =>
      getDb().select().from(schema.audienceImport).where(eq(schema.audienceImport.fileName, "dup.xlsx"))
    );
    expect(aud).toHaveLength(0);
  });

  it("aislamiento: no se puede usar la etiqueta de otra organización", async () => {
    const [tagA] = await runWithOrganization(A.id, () =>
      getDb().select().from(schema.contactTag).where(and(eq(schema.contactTag.organizationId, A.id), eq(schema.contactTag.name, "Referido")))
    );
    const err = await importar(B.id, "b.xlsx", { kind: "existing", id: tagA!.id }, [
      ["Nombre", "Teléfono", "Etiquetas"],
      ["Eva", "5214621000005", ""],
    ]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TagError);
    expect((err as TagError).code).toBe("not_found");
    expect(await tagsOf(B.id, "524621000005")).toEqual([]);
  });

  it("aislamiento: «Referido» nuevo en B es otra etiqueta y A no se entera", async () => {
    await importar(B.id, "b2.xlsx", { kind: "new", name: "Referido", color: null }, [
      ["Nombre", "Teléfono", "Etiquetas"],
      ["Eva", "5214621000006", ""],
    ]);
    expect(await tagsOf(B.id, "524621000006")).toEqual(["Import: b2.xlsx", "Referido"]);
    // Ningún contacto de B aparece en A, ni a la inversa.
    expect(await tagsOf(A.id, "524621000006")).toEqual([]);
    expect(await tagsOf(B.id, "524621000001")).toEqual([]);
    const enA = await runWithOrganization(A.id, () =>
      getDb().select().from(schema.contactTagAssignment).where(eq(schema.contactTagAssignment.organizationId, A.id))
    );
    expect(enA.every((r) => r.organizationId === A.id)).toBe(true);
  });
});
