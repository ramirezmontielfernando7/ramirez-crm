import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Conector de IA (047, migración 0060) — los datos solos, contra Postgres
 * real: las reglas que cuida la BD aunque el código se equivoque.
 */
type Org = Awaited<ReturnType<typeof crearOrganizacion>> & { ownerId: string };

describe("conector de IA — datos (0060)", () => {
  let A: Org;
  let B: Org;
  const db = () => getSystemDb();

  async function conDueno(nombre: string): Promise<Org> {
    const org = await crearOrganizacion(nombre);
    const ownerId = newId("user");
    await db().insert(schema.user).values({ id: ownerId, name: nombre, email: `${ownerId}@x.test`, emailVerified: true });
    await db().insert(schema.member).values({ id: newId("member"), organizationId: org.id, userId: ownerId, role: "owner" });
    return { ...org, ownerId };
  }

  async function conexion(org: Org, scopes = ["read", "write"]) {
    const id = newId("aiConnection");
    await db()
      .insert(schema.aiConnection)
      .values({ id, organizationId: org.id, userId: org.ownerId, kind: "oauth", name: "Claude de prueba", scopes });
    return id;
  }

  beforeAll(async () => {
    A = await conDueno("Conector A");
    B = await conDueno("Conector B");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
    await db().delete(schema.user).where(inArray(schema.user.id, [A.ownerId, B.ownerId]));
  });

  it("nace apagado: el complemento, los ajustes y el interruptor de «Mi número»", async () => {
    await db().insert(schema.aiConnectorSettings).values({ organizationId: A.id });
    const [ajustes] = await db()
      .select()
      .from(schema.aiConnectorSettings)
      .where(eq(schema.aiConnectorSettings.organizationId, A.id));
    expect(ajustes).toMatchObject({ enabled: false, allowedRoles: [], dailyMessageLimit: 100 });
    const [cols] = await db().execute<{ modulo: string; numero: string }>(
      `select (select column_default from information_schema.columns where table_name = 'organization_module' and column_name = 'conector_ia') as modulo,
              (select column_default from information_schema.columns where table_name = 'direct_number' and column_name = 'ai_connector') as numero`
    );
    expect(cols).toEqual({ modulo: "false", numero: "false" });
  });

  it("ajustes: solo roles conocidos (nunca el Propietario en la lista) y tope entre 0 y 1000", async () => {
    await expect(
      db().update(schema.aiConnectorSettings).set({ allowedRoles: ["owner"] }).where(eq(schema.aiConnectorSettings.organizationId, A.id))
    ).rejects.toThrow();
    await expect(
      db().update(schema.aiConnectorSettings).set({ dailyMessageLimit: 5000 }).where(eq(schema.aiConnectorSettings.organizationId, A.id))
    ).rejects.toThrow();
    await db()
      .update(schema.aiConnectorSettings)
      .set({ allowedRoles: ["coordinador", "asesor"], dailyMessageLimit: 0 })
      .where(eq(schema.aiConnectorSettings.organizationId, A.id));
  });

  it("una conexión siempre puede leer; «write» sin «read» no existe", async () => {
    await expect(conexion(A, ["write"])).rejects.toThrow();
    await expect(conexion(A, ["read", "admin"])).rejects.toThrow();
    expect(await conexion(A, ["read"])).toMatch(/^aic_/);
  });

  it("llaves: la personal no caduca y las de OAuth sí; el hash no se repite", async () => {
    const cx = await conexion(A);
    const base = { organizationId: A.id, connectionId: cx, tokenPrefix: "dfk_abcd" };
    await expect(db().insert(schema.aiToken).values({ ...base, id: newId("aiToken"), kind: "access", tokenHash: "h1" })).rejects.toThrow();
    await expect(
      db().insert(schema.aiToken).values({ ...base, id: newId("aiToken"), kind: "key", tokenHash: "h2", expiresAt: new Date() })
    ).rejects.toThrow();
    await db().insert(schema.aiToken).values({ ...base, id: newId("aiToken"), kind: "key", tokenHash: "h3" });
    await expect(db().insert(schema.aiToken).values({ ...base, id: newId("aiToken"), kind: "key", tokenHash: "h3" })).rejects.toThrow();
  });

  it("una llave no puede colgar de la conexión de OTRA organización", async () => {
    const deA = await conexion(A);
    await expect(
      db().insert(schema.aiToken).values({
        id: newId("aiToken"),
        organizationId: B.id,
        connectionId: deA,
        kind: "key",
        tokenHash: "cruzada",
        tokenPrefix: "dfk_x",
      })
    ).rejects.toThrow();
  });

  it("la bitácora no guarda resúmenes largos ni herramientas inventadas", async () => {
    const base = { organizationId: A.id, userId: A.ownerId, outcome: "ok" as const };
    await expect(db().insert(schema.aiActionLog).values({ ...base, id: newId("aiActionLog"), tool: "DROP TABLE" })).rejects.toThrow();
    await expect(
      db().insert(schema.aiActionLog).values({ ...base, id: newId("aiActionLog"), tool: "send_message", summary: "x".repeat(201) })
    ).rejects.toThrow();
    await db().insert(schema.aiActionLog).values({ ...base, id: newId("aiActionLog"), tool: "send_message", summary: "Envió 42 caracteres" });
  });
});
