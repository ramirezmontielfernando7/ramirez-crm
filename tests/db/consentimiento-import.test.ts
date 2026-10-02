import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { findOptOutConflicts, importContacts, importValidated } from "@/server/contacts-io/import";
import { importAudienceFile } from "@/server/campaigns/audiences";
import { validateImport } from "@/server/contacts-io/validate";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Consentimiento al importar contra Postgres real: la declaración ("Sí" /
 * "No lo sé"), la columna del archivo que manda, el tratamiento de quien ya
 * tiene `opt_out` (respetar / reactivar / sin confirmar) con su bitácora en
 * la MISMA transacción, y los conteos finales.
 */
describe("consentimiento al importar", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let userId: string;
  const enc = (s: string) => new TextEncoder().encode(s);
  const inA = <T>(fn: () => Promise<T>) => runWithOrganization(A.id, fn);

  async function contacto(waIdentity: string) {
    const c = await buscar(waIdentity);
    if (!c) throw new Error(`no existe el contacto ${waIdentity}`);
    return c;
  }
  async function buscar(waIdentity: string) {
    const [c] = await inA(() =>
      getDb()
        .select()
        .from(schema.contact)
        .where(and(eq(schema.contact.organizationId, A.id), eq(schema.contact.waIdentity, waIdentity)))
    );
    return c;
  }
  async function eventos(contactId: string) {
    return inA(() =>
      getDb()
        .select()
        .from(schema.contactActivityEvent)
        .where(
          and(
            eq(schema.contactActivityEvent.organizationId, A.id),
            eq(schema.contactActivityEvent.contactId, contactId),
            eq(schema.contactActivityEvent.kind, "consent_changed")
          )
        )
    );
  }
  async function crear(waIdentity: string, waConsent: "opt_in" | "opt_out" | "desconocido", name = "Previo") {
    await inA(() =>
      getDb()
        .insert(schema.contact)
        .values({
          id: newId("contact"),
          organizationId: A.id,
          waIdentity,
          phone: waIdentity,
          name,
          waConsent,
          waConsentSource: waConsent === "opt_out" ? "Escribió BAJA" : null,
          waConsentAt: waConsent === "opt_out" ? new Date("2026-09-01T12:00:00Z") : null,
        })
    );
  }

  beforeAll(async () => {
    A = await crearOrganizacion("Consentimiento A");
    userId = newId("user");
    await getSystemDb()
      .insert(schema.user)
      .values({ id: userId, name: "Coordinadora", email: `${userId}@x.test`, emailVerified: true });
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, userId));
  });

  it("«No lo sé»: los nuevos quedan sin confirmar y los existentes no cambian", async () => {
    await crear("524620000101", "opt_in");
    const s = await inA(() =>
      importContacts({
        organizationId: A.id,
        actorUserId: userId,
        fileName: "nolose.csv",
        text: "name,phone\nNuevo,524620000100\nYa acepta,524620000101\n",
        consentAnswer: "unknown",
      })
    );
    expect(s.consent).toEqual({ optIn: 1, optOut: 0, unknown: 1, reactivated: 0, toUnknown: 0 });
    expect((await contacto("524620000100")).waConsent).toBe("desconocido");
    expect((await contacto("524620000101")).waConsent).toBe("opt_in");
  });

  it("«Sí»: opt_in «declarado al importar», salvo donde la columna diga otra cosa; con bitácora", async () => {
    await crear("524620000201", "desconocido");
    const s = await inA(() =>
      importContacts({
        organizationId: A.id,
        actorUserId: userId,
        fileName: "si.csv",
        text: "name,phone,waConsent\nNueva,524620000200,\nExistente,524620000201,\nColumna,524620000202,desconocido\n",
        consentAnswer: "yes",
      })
    );
    expect(s.consent).toMatchObject({ optIn: 2, unknown: 1 });
    expect(await contacto("524620000200")).toMatchObject({ waConsent: "opt_in", waConsentSource: "declarado al importar" });
    const existente = await contacto("524620000201");
    expect(existente).toMatchObject({ waConsent: "opt_in", waConsentSource: "declarado al importar" });
    expect((await contacto("524620000202")).waConsent).toBe("desconocido");
    const [ev] = await eventos(existente.id);
    expect(ev).toMatchObject({ actorUserId: userId, source: "usuario" });
    expect(ev?.detail).toMatchObject({ from: "desconocido", to: "opt_in", source: "declarado al importar" });
  });

  it("la vista previa lista a quien ya tiene baja, con desde cuándo y su origen", async () => {
    await crear("524620000301", "opt_out", "Baja vieja");
    const v = validateImport("name,phone\nOtra,524620000300\nBaja vieja,524620000301\n");
    const p = await inA(() => findOptOutConflicts(A.id, v.rows));
    expect(p.count).toBe(1);
    expect(p.rows[0]).toMatchObject({
      line: 3,
      name: "Baja vieja",
      phone: "524620000301",
      since: "2026-09-01T12:00:00.000Z",
      source: "Escribió BAJA",
    });
  });

  it("respetar: la baja se queda aunque la declaración diga «Sí», sin bitácora de cambio", async () => {
    const s = await inA(() =>
      importContacts({
        organizationId: A.id,
        actorUserId: userId,
        fileName: "respeta.csv",
        text: "name,phone\nBaja vieja,524620000301\n",
        consentAnswer: "yes",
        optOutTreatment: "respect",
      })
    );
    expect(s.consent).toEqual({ optIn: 0, optOut: 1, unknown: 0, reactivated: 0, toUnknown: 0 });
    expect(s.warnings[0]?.reason).toMatch(/Se respetó/);
    const c = await contacto("524620000301");
    expect(c.waConsent).toBe("opt_out");
    expect(await eventos(c.id)).toEqual([]);
  });

  it("reactivar: opt_in con quién, cuándo y fuente; una fila que dice opt_out no se reactiva", async () => {
    await crear("524620000401", "opt_out");
    const s = await inA(() =>
      importContacts({
        organizationId: A.id,
        actorUserId: userId,
        fileName: "reactiva.csv",
        text: "name,phone,waConsent\nBaja vieja,524620000301,\nSigue baja,524620000401,opt_out\n",
        consentAnswer: "unknown",
        optOutTreatment: "opt_in",
      })
    );
    expect(s.consent).toEqual({ optIn: 1, optOut: 1, unknown: 0, reactivated: 1, toUnknown: 0 });
    const c = await contacto("524620000301");
    expect(c).toMatchObject({ waConsent: "opt_in", waConsentSource: "Reactivado al importar (reactiva.csv)" });
    expect(c.waConsentAt!.getTime()).toBeGreaterThan(new Date("2026-09-02").getTime());
    const [ev] = await eventos(c.id);
    expect(ev).toMatchObject({ actorUserId: userId, source: "usuario" });
    expect(ev?.detail).toMatchObject({ from: "opt_out", to: "opt_in", file: "reactiva.csv" });
    expect((await contacto("524620000401")).waConsent).toBe("opt_out");
  });

  it("sin confirmar (en Audiencias): la baja pasa a desconocido y queda en los conteos de la base", async () => {
    const { audience, summary } = await inA(() =>
      importAudienceFile({
        organizationId: A.id,
        userId,
        fileName: "limbo.csv",
        bytes: enc("nombre,numero\nSigue baja,524620000401\nNueva limbo,524620000500\n"),
        consentAnswer: "unknown",
        optOutTreatment: "desconocido",
      })
    );
    expect(summary.consent).toEqual({ optIn: 0, optOut: 0, unknown: 2, reactivated: 0, toUnknown: 1 });
    expect(audience.counts).toMatchObject({ consentUnknown: 2, toUnknown: 1, reactivated: 0 });
    expect(audience.consentSource).toBe("sin declarar");
    const c = await contacto("524620000401");
    expect(c).toMatchObject({ waConsent: "desconocido", waConsentSource: "Pasado a sin confirmar al importar (limbo.csv)" });
    expect((await eventos(c.id)).map((e) => e.detail?.to)).toEqual(["desconocido"]);
  });

  it("todo o nada: si la importación falla, ni el consentimiento ni la bitácora cambian", async () => {
    await crear("524620000601", "opt_out");
    await expect(
      inA(() =>
        importValidated({
          organizationId: A.id,
          actorUserId: userId,
          fileName: "falla.csv",
          validation: validateImport("name,phone\nBaja,524620000601\nNueva,524620000600\n"),
          consentAnswer: "yes",
          optOutTreatment: "opt_in",
          onMembers: async () => {
            throw new Error("falla a propósito");
          },
        })
      )
    ).rejects.toThrow("falla a propósito");
    const c = await contacto("524620000601");
    expect(c.waConsent).toBe("opt_out");
    expect(await eventos(c.id)).toEqual([]);
    expect(await buscar("524620000600")).toBeUndefined();
  });
});
