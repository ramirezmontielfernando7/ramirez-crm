import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getDb, getSystemDb, withTenant, schema } from "@/lib/db";
import { chatJson, LlmInTransactionError } from "@/lib/ai";
import { runWithOrganization } from "@/lib/request-context";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * PR 3 multitenant — `withTenant` y el pool de la app contra Postgres real.
 * Todavía sin políticas: aquí se prueba que `app.org_id` llega bien fijado a
 * cada consulta (el PR 4 filtra con él) y que una llamada al LLM jamás
 * ocurre con una transacción abierta.
 */

const orgIdEnBd = async () => {
  const [row] = await getDb().execute<{ org: string | null }>(
    sql`select nullif(current_setting('app.org_id', true), '') as org`
  );
  return row?.org ?? null;
};

let a: { id: string };
let b: { id: string };

beforeAll(async () => {
  a = await crearOrganizacion("WT-A");
  b = await crearOrganizacion("WT-B");
});

afterAll(async () => {
  await borrarOrganizaciones([a.id, b.id]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("app.org_id por consulta", () => {
  it("dentro de runWithOrganization cada consulta lo lleva fijado", async () => {
    await runWithOrganization(a.id, async () => {
      expect(await orgIdEnBd()).toBe(a.id);
      expect(await orgIdEnBd()).toBe(a.id);
    });
    await runWithOrganization(b.id, async () => {
      expect(await orgIdEnBd()).toBe(b.id);
    });
  });

  it("una consulta perezosa devuelta tal cual corre con la organización", async () => {
    // Sin async: runWithOrganization recibe el thenable de drizzle sin
    // ejecutar y debe arrancarlo dentro del contexto.
    const filas = await runWithOrganization(b.id, () =>
      getDb().execute<{ org: string }>(sql`select current_setting('app.org_id', true) as org`)
    );
    expect(filas[0]?.org).toBe(b.id);
  });

  it("es local a la transacción: la conexión vuelve limpia al pool", async () => {
    // Pool de sistema: sin organización y sin DB_TENANT_STRICT de por medio.
    for (let i = 0; i < 20; i++) {
      await runWithOrganization(a.id, () => orgIdEnBd());
    }
    const [row] = await getSystemDb().execute<{ org: string | null }>(
      sql`select nullif(current_setting('app.org_id', true), '') as org`
    );
    expect(row?.org ?? null).toBeNull();
  });

  it("dos organizaciones en paralelo no se mezclan", async () => {
    const vistas = await Promise.all(
      Array.from({ length: 30 }, (_, i) => {
        const org = i % 2 === 0 ? a.id : b.id;
        return runWithOrganization(org, async () => ({ org, visto: await orgIdEnBd() }));
      })
    );
    for (const v of vistas) expect(v.visto).toBe(v.org);
  });

  it("db.transaction() explícito también lo fija", async () => {
    await runWithOrganization(a.id, () =>
      getDb().transaction(async (tx) => {
        const [row] = await tx.execute<{ org: string }>(
          sql`select current_setting('app.org_id', true) as org`
        );
        expect(row?.org).toBe(a.id);
      })
    );
  });

  it("con DB_TENANT_STRICT=true, una consulta sin organización lanza", async () => {
    vi.stubEnv("DB_TENANT_STRICT", "true");
    const err = await getDb()
      .select()
      .from(schema.organization)
      .limit(1)
      .then(() => null, (e: unknown) => e as Error & { cause?: Error });
    // drizzle envuelve el error ("Failed query…"); el nuestro va en `cause`.
    expect(err?.cause?.message).toMatch(/sin organización/);
  });
});

describe("withTenant", () => {
  it("abre UNA transacción: getDb() dentro es la misma y ve lo no confirmado", async () => {
    const pids = await withTenant(a.id, async (tx) => {
      const [p1] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      const [p2] = await getDb().execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      expect(await orgIdEnBd()).toBe(a.id);
      return [p1?.pid, p2?.pid];
    });
    expect(pids[0]).toBe(pids[1]);
  });

  it("revierte todo si fn lanza", async () => {
    const nombre = `rollback-${Math.random().toString(36).slice(2, 8)}`;
    await expect(
      withTenant(a.id, async (tx) => {
        await tx.insert(schema.contactTag).values({
          id: `tag_${nombre}`,
          organizationId: a.id,
          name: nombre,
        });
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    const filas = await runWithOrganization(a.id, () =>
      getDb().execute(sql`select 1 from contact_tag where name = ${nombre}`)
    );
    expect(filas.length).toBe(0);
  });

  it("anidado con la misma organización reutiliza la transacción; con otra, lanza", async () => {
    await withTenant(a.id, async () => {
      await expect(withTenant(a.id, async () => orgIdEnBd())).resolves.toBe(a.id);
      await expect(withTenant(b.id, async () => orgIdEnBd())).rejects.toThrow(/otra organización/);
    });
  });
});

describe("el LLM nunca con una transacción abierta", () => {
  const Esquema = z.object({ ok: z.boolean() });
  const mensajes = [{ role: "user" as const, content: "hola" }];

  function llmFalso() {
    vi.stubEnv("OPENROUTER_API_TOKEN", "sk-test");
    vi.stubEnv("OPENROUTER_MODEL", "modelo/de-prueba");
    const fetchFalso = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })
    );
    vi.stubGlobal("fetch", fetchFalso);
    return fetchFalso;
  }

  it("dentro de withTenant, chatJson lanza sin llegar al proveedor", async () => {
    const fetchFalso = llmFalso();
    await expect(
      withTenant(a.id, async () => chatJson(Esquema, mensajes))
    ).rejects.toBeInstanceOf(LlmInTransactionError);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("dentro de un db.transaction() explícito, también", async () => {
    llmFalso();
    await expect(
      runWithOrganization(a.id, () => getDb().transaction(async () => chatJson(Esquema, mensajes)))
    ).rejects.toBeInstanceOf(LlmInTransactionError);
  });

  it("entre consultas de la misma organización (sin transacción abierta), funciona", async () => {
    llmFalso();
    const r = await runWithOrganization(a.id, async () => {
      await orgIdEnBd();
      const res = await chatJson(Esquema, mensajes, { model: "modelo/de-prueba" });
      await orgIdEnBd();
      return res;
    });
    expect(r.ok).toBe(true);
  });

  it("después de cerrar withTenant, funciona", async () => {
    llmFalso();
    const r = await runWithOrganization(a.id, async () => {
      await withTenant(a.id, async () => orgIdEnBd());
      return chatJson(Esquema, mensajes, { model: "modelo/de-prueba" });
    });
    expect(r.ok).toBe(true);
  });
});
