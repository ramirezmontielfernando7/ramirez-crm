import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { buildXlsx } from "@/server/contacts-io/xlsx-write";
import {
  audienceFailures,
  deleteAudience,
  getAudience,
  importAudienceFile,
  listAudiences,
} from "@/server/campaigns/audiences";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Campañas v2, PR 2 — Audiencias contra Postgres real: la base .xlsx entra
 * con el núcleo de la importación (dedupe, opt_out pegajoso, etiqueta), la
 * declaración de consentimiento deja `opt_in` a los que no traen columna,
 * se guardan miembros y columnas extra, y otra organización no la ve.
 */
describe("audiencias", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let B: Awaited<ReturnType<typeof crearOrganizacion>>;
  let userId: string;

  beforeAll(async () => {
    A = await crearOrganizacion("Audiencias A");
    B = await crearOrganizacion("Audiencias B");
    userId = newId("user");
    await getSystemDb()
      .insert(schema.user)
      .values({ id: userId, name: "Dueña", email: `${userId}@x.test`, emailVerified: true });
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, userId));
  });

  it("importa un .xlsx con asignación manual, consentimiento declarado y columnas extra", async () => {
    // Un contacto que ya existía y pidió la baja: sigue en opt_out.
    await runWithOrganization(A.id, () =>
      getDb().insert(schema.contact).values({
        id: newId("contact"),
        organizationId: A.id,
        waIdentity: "524621000002",
        phone: "524621000002",
        name: "Ya existía",
        waConsent: "opt_out",
        email: "previo@x.mx",
      })
    );
    const bytes = buildXlsx("Base", [
      ["Persona", "Móvil", "Mail", "Cupón"],
      ["Ana", "5214621000001", "ana@x.mx", "A10"],
      ["Beto", "524621000002", "beto@x.mx", "B20"],
      ["Mal", "123", "", ""],
      ["Ana repetida", "524621000001", "", ""],
    ]);
    const { audience, summary } = await runWithOrganization(A.id, () =>
      importAudienceFile({
        organizationId: A.id,
        userId,
        fileName: "base.xlsx",
        bytes,
        mapping: { name: 0, phone: 1, email: 2 },
        consentDeclaration: "Formulario en mi sitio web",
      })
    );
    expect(summary).toMatchObject({ created: 1, updated: 1, failed: 2 });
    expect(audience).toMatchObject({
      fileKind: "xlsx",
      columns: ["Cupón"],
      counts: { totalRows: 4, created: 1, updated: 1, invalid: 1, duplicate: 1, members: 2 },
      consent: { optIn: 1, optOut: 1, unknown: 0 },
      failuresCount: 2,
    });
    expect(audience.tag?.name).toBe("Import: base.xlsx");

    const contacts = await runWithOrganization(A.id, () =>
      getDb().select().from(schema.contact).where(eq(schema.contact.organizationId, A.id))
    );
    const ana = contacts.find((c) => c.waIdentity === "524621000001")!;
    const beto = contacts.find((c) => c.waIdentity === "524621000002")!;
    expect(ana).toMatchObject({ waConsent: "opt_in", waConsentSource: "Formulario en mi sitio web", email: "ana@x.mx" });
    // opt_out pegajoso y el correo existente no se pisa.
    expect(beto).toMatchObject({ waConsent: "opt_out", email: "previo@x.mx" });

    const members = await runWithOrganization(A.id, () =>
      getDb()
        .select()
        .from(schema.audienceMember)
        .where(and(eq(schema.audienceMember.organizationId, A.id), eq(schema.audienceMember.importId, audience.id)))
    );
    expect(members.find((m) => m.contactId === ana.id)?.fields).toEqual({ Cupón: "A10" });

    const failures = await runWithOrganization(A.id, () => audienceFailures(A.id, audience.id));
    expect(failures.failures.map((f) => f.line)).toEqual([4, 5]);
  });

  it("sin declaración de consentimiento no importa nada", async () => {
    await expect(
      runWithOrganization(A.id, () =>
        importAudienceFile({
          organizationId: A.id,
          userId,
          fileName: "x.csv",
          bytes: new TextEncoder().encode("nombre,numero\nZed,5214621000009\n"),
          consentDeclaration: " ",
        })
      )
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("otra organización no ve ni borra la audiencia (404)", async () => {
    const [mine] = await runWithOrganization(A.id, () => listAudiences(A.id));
    expect(mine).toBeDefined();
    expect(await runWithOrganization(B.id, () => listAudiences(B.id))).toEqual([]);
    await expect(runWithOrganization(B.id, () => getAudience(B.id, mine!.id))).rejects.toMatchObject({ code: "not_found" });
    await expect(runWithOrganization(B.id, () => deleteAudience(B.id, mine!.id))).rejects.toMatchObject({ code: "not_found" });
    // Borrar la base no borra los contactos.
    await runWithOrganization(A.id, () => deleteAudience(A.id, mine!.id));
    const left = await runWithOrganization(A.id, () =>
      getDb().select({ id: schema.contact.id }).from(schema.contact).where(eq(schema.contact.organizationId, A.id))
    );
    expect(left.length).toBe(2);
  });
});
