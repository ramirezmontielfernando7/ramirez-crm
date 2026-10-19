import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { configFromProfile, MIRROR_DEFAULT_NAME } from "@/server/agents/config";
import { demoBlockReason, isDomainEmpty } from "@/server/seed/demo";

/**
 * «Cargar datos de demostración» borra el conocimiento y reemplaza el agente:
 * solo corre en una empresa realmente vacía (sin contactos, sin conocimiento
 * y sin agente editado). Sin BD: una BD falsa devuelve filas por tabla.
 */

const factory = configFromProfile({
  name: MIRROR_DEFAULT_NAME,
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
});

type Fake = {
  contact?: unknown[];
  kb_entry?: unknown[];
  agent?: unknown[];
  agent_profile?: unknown[];
};

function fakeDb(data: Fake) {
  const db = {
    select: () => ({
      from: (t: PgTable) => ({
        where: () => {
          const rows = (data as Record<string, unknown[]>)[getTableName(t)] ?? [];
          return Object.assign(Promise.resolve(rows), {
            limit: () => Promise.resolve(rows.slice(0, 1)),
          });
        },
      }),
    }),
  };
  return db as unknown as Parameters<typeof demoBlockReason>[0];
}

const pristine: Fake = {
  agent: [{ isGeneral: true, draft: factory, published: factory }],
  agent_profile: [
    { name: MIRROR_DEFAULT_NAME, tone: null, instructions: null, escalationRules: null, greeting: null },
  ],
};

describe("demoBlockReason: la demo solo entra en una empresa realmente vacía", () => {
  it("empresa vacía (solo el agente de fábrica): sí", async () => {
    expect(await demoBlockReason(fakeDb(pristine), "org_A")).toBeNull();
    expect(await isDomainEmpty(fakeDb(pristine), "org_A")).toBe(true);
  });

  it("con contactos: no", async () => {
    const r = await demoBlockReason(fakeDb({ ...pristine, contact: [{ id: "ct_1" }] }), "org_A");
    expect(r).toMatch(/contactos/);
  });

  it("con conocimiento propio: no", async () => {
    const r = await demoBlockReason(fakeDb({ ...pristine, kb_entry: [{ id: "kb_1" }] }), "org_A");
    expect(r).toMatch(/conocimiento/);
  });

  it("con el agente general editado (publicado): no", async () => {
    const edited = { ...factory, instructions: "Vende cortinas" };
    const r = await demoBlockReason(
      fakeDb({ ...pristine, agent: [{ isGeneral: true, draft: edited, published: edited }] }),
      "org_A"
    );
    expect(r).toMatch(/agente/);
  });

  it("con el general editado solo en borrador: no", async () => {
    const r = await demoBlockReason(
      fakeDb({
        ...pristine,
        agent: [{ isGeneral: true, draft: { ...factory, tone: "Formal" }, published: factory }],
      }),
      "org_A"
    );
    expect(r).toMatch(/agente/);
  });

  it("con el perfil editado (nombre o textos): no", async () => {
    const r = await demoBlockReason(
      fakeDb({ ...pristine, agent_profile: [{ name: "Lupita", tone: null, instructions: null, escalationRules: null, greeting: null }] }),
      "org_A"
    );
    expect(r).toMatch(/agente/);
  });

  it("con otro agente además del general: no", async () => {
    const r = await demoBlockReason(
      fakeDb({
        ...pristine,
        agent: [
          { isGeneral: true, draft: factory, published: factory },
          { isGeneral: false, draft: factory, published: null },
        ],
      }),
      "org_A"
    );
    expect(r).toMatch(/agente/);
    expect(await isDomainEmpty(fakeDb({ ...pristine, contact: [{ id: "x" }] }), "org_A")).toBe(false);
  });
});
