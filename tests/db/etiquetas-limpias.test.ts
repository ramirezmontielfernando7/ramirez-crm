import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { buildXlsx } from "@/server/contacts-io/xlsx-write";
import { importAudienceFile } from "@/server/campaigns/audiences";
import { importContacts } from "@/server/contacts-io/import";
import { listTags, mergeImpact, mergeTags, setContactTags, tagsForContacts, TagError } from "@/server/tags/tags";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Etiquetas limpias contra Postgres real: la automática «Import: archivo» es de
 * SISTEMA (no se lista, no se ve en el contacto, sí en Audiencias), el relleno
 * de la migración marca solo las enlazadas por `audience_import.tag_id`,
 * guardar las etiquetas visibles conserva las de sistema y la fusión es
 * atómica, no duplica, re-apunta Audiencias y no cruza organizaciones.
 */
describe("etiquetas limpias", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let B: Awaited<ReturnType<typeof crearOrganizacion>>;
  let userId: string;

  beforeAll(async () => {
    A = await crearOrganizacion("Limpias A");
    B = await crearOrganizacion("Limpias B");
    userId = newId("user");
    await getSystemDb()
      .insert(schema.user)
      .values({ id: userId, name: "Dueña", email: `${userId}@x.test`, emailVerified: true });
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, userId));
  });

  const rows = (...phones: string[]) => [
    ["Nombre", "Teléfono"],
    ...phones.map((p) => [`Persona ${p.slice(-3)}`, p] as string[]),
  ];
  const aud = (org: string, file: string, phones: string[], extraTag?: { kind: "existing"; id: string } | null) =>
    runWithOrganization(org, () =>
      importAudienceFile({
        organizationId: org,
        userId,
        fileName: file,
        bytes: buildXlsx("Base", rows(...phones)),
        mapping: { name: 0, phone: 1 },
        consentAnswer: "yes",
        extraTag,
      })
    );
  const allTags = (org: string) =>
    runWithOrganization(org, () => listTags(org, { system: "include" }));
  const contactId = async (org: string, identity: string) =>
    (
      await runWithOrganization(org, () =>
        getDb()
          .select({ id: schema.contact.id })
          .from(schema.contact)
          .where(and(eq(schema.contact.organizationId, org), eq(schema.contact.waIdentity, identity)))
      )
    )[0]!.id;
  const mkTag = (org: string, name: string) =>
    runWithOrganization(org, async () => {
      const id = newId("contactTag");
      await getDb().insert(schema.contactTag).values({ id, organizationId: org, name });
      return id;
    });
  const tagNamesOf = (org: string, cid: string, includeSystem = false) =>
    runWithOrganization(org, async () =>
      ((await tagsForContacts(org, [cid], { includeSystem })).get(cid) ?? []).map((t) => t.name).sort()
    );

  it("la automática de una importación de Audiencias es de sistema y Audiencias la sigue mostrando", async () => {
    const { audience } = await aud(A.id, "base1.xlsx", ["524622000001", "524622000002"]);
    expect(audience.tag?.name).toBe("Import: base1.xlsx");
    const sys = await runWithOrganization(A.id, () => listTags(A.id, { system: "only" }));
    expect(sys.map((t) => t.name)).toContain("Import: base1.xlsx");
    expect(sys.every((t) => t.system === true)).toBe(true);
    // Por defecto NO sale: ni en el listado ni en las etiquetas del contacto.
    const pub = await runWithOrganization(A.id, () => listTags(A.id));
    expect(pub.map((t) => t.name)).not.toContain("Import: base1.xlsx");
    const cid = await contactId(A.id, "524622000001");
    expect(await tagNamesOf(A.id, cid)).toEqual([]);
    expect(await tagNamesOf(A.id, cid, true)).toEqual(["Import: base1.xlsx"]);
  });

  it("la que elige la persona nunca es de sistema; una creada a mano con el nombre automático tampoco se marca", async () => {
    await runWithOrganization(A.id, () =>
      importContacts({
        organizationId: A.id,
        actorUserId: userId,
        fileName: "c.csv",
        text: "name,phone\nElla,524622000010\n",
        tagName: "Mi etiqueta",
        consentAnswer: "yes",
      })
    );
    await mkTag(A.id, "Import: manual.xlsx"); // la creó una persona
    await aud(A.id, "manual.xlsx", ["524622000011"]);
    const tags = await allTags(A.id);
    expect(tags.find((t) => t.name === "Mi etiqueta")?.system).toBeUndefined();
    expect(tags.find((t) => t.name === "Import: manual.xlsx")?.system).toBeUndefined();
  });

  it("una importación de Contactos sin etiqueta propia crea la automática de sistema", async () => {
    await runWithOrganization(A.id, () =>
      importContacts({
        organizationId: A.id,
        actorUserId: userId,
        fileName: "auto.csv",
        text: "name,phone\nElla,524622000012\n",
        consentAnswer: "yes",
      })
    );
    expect((await allTags(A.id)).find((t) => t.name === "Import: auto.csv")?.system).toBe(true);
  });

  it("el relleno de la migración marca solo las enlazadas por audience_import.tag_id y es idempotente", async () => {
    const sqlFile = readFileSync("drizzle/0041_etiquetas_sistema.sql", "utf8");
    const backfill = sqlFile.split("--> statement-breakpoint").pop()!.trim();
    expect(backfill.startsWith("UPDATE")).toBe(true);
    const enlazada = await mkTag(B.id, "Import: vieja-aud.xlsx");
    const legado = await mkTag(B.id, "Import: legado-contactos.csv"); // sin audiencia
    await runWithOrganization(B.id, () =>
      getDb().insert(schema.audienceImport).values({
        id: newId("audienceImport"),
        organizationId: B.id,
        name: "vieja",
        fileName: "vieja-aud.xlsx",
        fileKind: "xlsx",
        tagId: enlazada,
        consentSource: "sin declarar",
        columns: [],
        counts: {},
        failures: [],
        createdBy: userId,
      } as never)
    );
    await getSystemDb().execute(sql.raw(backfill));
    await getSystemDb().execute(sql.raw(backfill));
    const tags = await allTags(B.id);
    expect(tags.find((t) => t.id === enlazada)?.system).toBe(true);
    expect(tags.find((t) => t.id === legado)?.system).toBeUndefined();
  });

  it("guardar las etiquetas visibles de un contacto conserva las de sistema", async () => {
    const cid = await contactId(A.id, "524622000001");
    const vip = await mkTag(A.id, "VIP");
    const out = await runWithOrganization(A.id, () => setContactTags(A.id, cid, [vip], userId));
    expect(out.map((t) => t.name)).toEqual(["VIP"]);
    expect(await tagNamesOf(A.id, cid, true)).toEqual(["Import: base1.xlsx", "VIP"]);
    // Vaciar las visibles tampoco toca la automática.
    await runWithOrganization(A.id, () => setContactTags(A.id, cid, [], userId));
    expect(await tagNamesOf(A.id, cid, true)).toEqual(["Import: base1.xlsx"]);
  });

  describe("fusionar", () => {
    it("mueve sin duplicar, re-apunta Audiencias, borra el origen y deja la línea de tiempo", async () => {
      const dest = await mkTag(A.id, "Referido");
      const phones = ["524623000001", "524623000002", "524623000003"];
      const { audience } = await aud(A.id, "fusion.xlsx", phones);
      const srcId = audience.tag!.id;
      // Uno ya tenía el destino.
      const c1 = await contactId(A.id, phones[0]!);
      await runWithOrganization(A.id, () => setContactTags(A.id, c1, [dest], userId));

      const impact = await runWithOrganization(A.id, () => mergeImpact(A.id, srcId, dest));
      expect(impact).toMatchObject({ moved: 2, alreadyHad: 1, audiences: 1 });

      const r = await runWithOrganization(A.id, () => mergeTags(A.id, srcId, dest, userId));
      expect(r).toMatchObject({ moved: 2, alreadyHad: 1, audiences: 1 });
      expect(r.tag.contactCount).toBe(3);

      const tags = await allTags(A.id);
      expect(tags.some((t) => t.id === srcId)).toBe(false);
      for (const p of phones) {
        expect(await tagNamesOf(A.id, await contactId(A.id, p), true)).toEqual(["Referido"]);
      }
      // Audiencias ahora apunta al destino (no quedó en NULL).
      const [row] = await runWithOrganization(A.id, () =>
        getDb().select().from(schema.audienceImport).where(eq(schema.audienceImport.id, audience.id))
      );
      expect(row?.tagId).toBe(dest);
      const events = await runWithOrganization(A.id, () =>
        getDb()
          .select()
          .from(schema.contactActivityEvent)
          .where(and(eq(schema.contactActivityEvent.organizationId, A.id), eq(schema.contactActivityEvent.kind, "tag_added")))
      );
      // Solo los 2 que ganaron el destino por la fusión (+ el del c1 al etiquetarlo).
      expect(events.filter((e) => (e.detail as { tag?: string } | null)?.tag === "Referido")).toHaveLength(3);
    });

    it("una etiqueta de sistema no puede ser el destino", async () => {
      const normal = await mkTag(A.id, "Normal fuente");
      const sys = (await allTags(A.id)).find((t) => t.system)!;
      const err = await runWithOrganization(A.id, () => mergeTags(A.id, normal, sys.id, userId)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TagError);
      expect((err as TagError).code).toBe("system_target");
      const err2 = await runWithOrganization(A.id, () => mergeImpact(A.id, normal, sys.id)).catch((e: unknown) => e);
      expect((err2 as TagError).code).toBe("system_target");
      // La fuente sigue ahí: no se perdió nada.
      expect((await allTags(A.id)).some((t) => t.id === normal)).toBe(true);
    });

    it("origen igual a destino es inválido", async () => {
      const t = await mkTag(A.id, "Sola");
      const err = await runWithOrganization(A.id, () => mergeTags(A.id, t, t, userId)).catch((e: unknown) => e);
      expect((err as TagError).code).toBe("invalid");
    });

    it("aislamiento: ni el origen ni el destino pueden ser de otra organización", async () => {
      const deA = await mkTag(A.id, "Solo de A");
      const deB = await mkTag(B.id, "Solo de B");
      const e1 = await runWithOrganization(A.id, () => mergeTags(A.id, deA, deB, userId)).catch((e: unknown) => e);
      const e2 = await runWithOrganization(B.id, () => mergeTags(B.id, deA, deB, userId)).catch((e: unknown) => e);
      const e3 = await runWithOrganization(A.id, () => mergeImpact(A.id, deA, deB)).catch((e: unknown) => e);
      for (const e of [e1, e2, e3]) expect((e as TagError).code).toBe("not_found");
      expect((await allTags(A.id)).some((t) => t.id === deA)).toBe(true);
      expect((await allTags(B.id)).some((t) => t.id === deB)).toBe(true);
    });
  });
});
