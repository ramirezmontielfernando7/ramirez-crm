import { randomBytes } from "node:crypto";
import path from "node:path";
import { eq, getTableName, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PG_CONNECTION_OPTIONS, schema } from "@/lib/db";
import { seedDemo } from "@/server/seed/demo";

/**
 * H1 — Cargar la demo en una organización jamás toca a otra.
 *
 * Los teléfonos de la demo son fijos (5215612340001…): otra organización
 * puede tener un cliente REAL con ese número. Antes, la limpieza de
 * idempotencia buscaba por teléfono en toda la base y borraba contactos,
 * conversaciones, mensajes y leads ajenos.
 *
 * Dos capas:
 * 1. Siempre (CI incluido): cada lectura y borrado de `seedDemo` lleva el
 *    filtro de la organización. Se revisa el SQL que arma, sin BD.
 * 2. Con `TEST_DATABASE_URL` (Postgres real, se migra una base NUEVA): dos
 *    organizaciones con un contacto de teléfono igual al de la demo, cargar
 *    la demo en A deja intactos los datos de B.
 */

const DEMO_PHONE = "5215612340001";
const dialect = new PgDialect();

/* ---------- 1 · Forma de las consultas (sin BD) ---------- */

type Recorded = { op: "select" | "delete" | "update"; table: string; where: SQL };

/** BD falsa que registra cada WHERE; devuelve filas mínimas por tabla. */
function recordingDb(orgId: string) {
  const recorded: Recorded[] = [];
  const rowsFor = (table: string): unknown[] => {
    if (table === "contact") return [{ id: "ct_prev" }];
    if (table === "conversation") return [{ id: "cv_prev" }];
    if (table === "pipeline_stage") return [{ id: "st_1", name: "Nuevo", organizationId: orgId }];
    return [];
  };
  const db = {
    select: () => ({
      from: (t: PgTable) => ({
        where: (where: SQL) => {
          const table = getTableName(t);
          recorded.push({ op: "select", table, where });
          const rows = rowsFor(table);
          return Object.assign(Promise.resolve(rows), {
            limit: () => Promise.resolve(rows),
          });
        },
      }),
    }),
    delete: (t: PgTable) => ({
      where: async (where: SQL) => {
        recorded.push({ op: "delete", table: getTableName(t), where });
      },
    }),
    update: (t: PgTable) => ({
      set: () => ({
        where: async (where: SQL) => {
          recorded.push({ op: "update", table: getTableName(t), where });
        },
      }),
    }),
    insert: () => ({ values: async () => {} }),
  };
  return { db: db as unknown as Parameters<typeof seedDemo>[0], recorded };
}

describe("seedDemo: toda consulta va acotada a la organización (sin BD)", () => {
  it("cada select, delete y update filtra por organization_id = la org que carga", async () => {
    const { db, recorded } = recordingDb("org_A");
    await seedDemo(db, "org_A");

    // Se ejercitó la limpieza completa (hubo contactos y conversaciones previos).
    const deleted = recorded.filter((r) => r.op === "delete").map((r) => r.table);
    expect(deleted).toEqual(
      expect.arrayContaining(["message", "conversation", "lead", "contact"])
    );

    for (const r of recorded) {
      const q = dialect.sqlToQuery(r.where);
      expect(q.sql, `${r.op} ${r.table}`).toMatch(
        new RegExp(`"${r.table}"\\."organization_id" = \\$\\d+`)
      );
      expect(q.params, `${r.op} ${r.table}`).toContain("org_A");
    }
  });
});

/* ---------- 2 · Dos organizaciones en Postgres real ---------- */

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("seedDemo con Postgres real: dos organizaciones", () => {
  const dbName = `vocero_seed_${randomBytes(4).toString("hex")}`;
  let admin: ReturnType<typeof postgres>;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    admin = postgres(TEST_DB!, { max: 1, ...PG_CONNECTION_OPTIONS });
    await admin.unsafe(`create database ${dbName}`);
    const url = new URL(TEST_DB!);
    url.pathname = `/${dbName}`;
    sql = postgres(url.toString(), { max: 2, ...PG_CONNECTION_OPTIONS });
    db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: path.resolve("drizzle") });
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop database if exists ${dbName}`);
    await admin?.end();
  });

  async function createOrg(id: string) {
    await db.insert(schema.organization).values({ id, name: id, slug: id });
    await db.insert(schema.pipelineStage).values({
      id: `st_${id}`,
      organizationId: id,
      name: "Nuevo",
      position: 0,
      kind: "open",
    });
    await db.insert(schema.agentProfile).values({ id: `ap_${id}`, organizationId: id });
  }

  /** Un cliente real con el MISMO teléfono que el primer contacto de la demo. */
  async function createCustomer(orgId: string) {
    const contactId = `ct_${orgId}`;
    const conversationId = `cv_${orgId}`;
    await db.insert(schema.contact).values({
      id: contactId,
      organizationId: orgId,
      phone: DEMO_PHONE,
      waIdentity: DEMO_PHONE,
      name: `Cliente de ${orgId}`,
    });
    await db.insert(schema.conversation).values({
      id: conversationId,
      organizationId: orgId,
      contactId,
    });
    await db.insert(schema.message).values({
      id: `msg_${orgId}`,
      organizationId: orgId,
      conversationId,
      waMessageId: `wamid.real.${orgId}`,
      direction: "in",
      text: "mensaje real",
      status: "delivered",
    });
    await db.insert(schema.lead).values({
      id: `ld_${orgId}`,
      organizationId: orgId,
      contactId,
      stageId: `st_${orgId}`,
    });
  }

  it("cargar la demo en A no toca el contacto, la conversación, el mensaje ni el lead de B", async () => {
    await createOrg("org_A");
    await createOrg("org_B");
    await createCustomer("org_A");
    await createCustomer("org_B");

    await seedDemo(db as unknown as Parameters<typeof seedDemo>[0], "org_A");

    // B intacta.
    const [contactB] = await db
      .select()
      .from(schema.contact)
      .where(eq(schema.contact.id, "ct_org_B"));
    expect(contactB?.name).toBe("Cliente de org_B");
    expect(contactB?.organizationId).toBe("org_B");
    expect(
      await db.select().from(schema.conversation).where(eq(schema.conversation.id, "cv_org_B"))
    ).toHaveLength(1);
    expect(
      await db.select().from(schema.message).where(eq(schema.message.id, "msg_org_B"))
    ).toHaveLength(1);
    expect(
      await db.select().from(schema.lead).where(eq(schema.lead.id, "ld_org_B"))
    ).toHaveLength(1);
    expect(
      await db.select().from(schema.contact).where(eq(schema.contact.organizationId, "org_B"))
    ).toHaveLength(1);

    // A sí se limpió (su contacto previo con el teléfono demo) y se sembró.
    expect(
      await db.select().from(schema.contact).where(eq(schema.contact.id, "ct_org_A"))
    ).toHaveLength(0);
    const contactsA = await db
      .select()
      .from(schema.contact)
      .where(eq(schema.contact.organizationId, "org_A"));
    expect(contactsA).toHaveLength(8);
  });
});
