import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { archiveThreads, deleteThreads, ensureGeneralThread, listThreads, saveExchange } from "@/server/assistant/threads";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Asistente — el Chat general fijo (uno por persona) y los hilos que se
 * archivan, desarchivan y borran de golpe. Postgres real, como `vocero_app`.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const sys = () => getSystemDb();
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);
const meta = { sources: [], flags: [], queryCount: 0, modelCalls: 1 };

async function persona(orgId: string, name: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@hilos.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: orgId, userId: id, role: "owner" });
  return id;
}

describe("asistente — Chat general e hilos archivables", () => {
  let A: Org;
  let ana: string;
  let beto: string;

  beforeAll(async () => {
    A = await crearOrganizacion("Hilos A");
    ana = await persona(A.id, "Ana Hilos");
    beto = await persona(A.id, "Beto Hilos");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
    for (const id of [ana, beto]) await sys().delete(schema.user).where(eq(schema.user.id, id));
  });

  const ask = (user: string, threadId: string | null, q: string) =>
    as(A.id, () =>
      saveExchange({ organizationId: A.id, userId: user, threadId, question: q, maskedQuestion: q, answer: "ok", maskedAnswer: "ok", meta, usage: { promptTokens: 1, completionTokens: 1 } })
    );

  it("el Chat general es uno por persona y no sale en la lista de hilos", async () => {
    const g1 = await as(A.id, () => ensureGeneralThread(A.id, ana));
    const g2 = await as(A.id, () => ensureGeneralThread(A.id, ana));
    expect(g2.id).toBe(g1.id);
    expect(g1.kind).toBe("general");
    expect((await as(A.id, () => ensureGeneralThread(A.id, beto))).id).not.toBe(g1.id);
    await ask(ana, g1.id, "pregunta en el general");
    expect((await as(A.id, () => listThreads(A.id, ana))).map((t) => t.id)).not.toContain(g1.id);
  });

  it("archivar, desarchivar y borrar de golpe: solo hilos propios; el general no se toca", async () => {
    const g = await as(A.id, () => ensureGeneralThread(A.id, ana));
    const t1 = await ask(ana, null, "uno");
    const t2 = await ask(ana, null, "dos");
    const t3 = await ask(ana, null, "tres");
    const ids = [t1.threadId, t2.threadId, t3.threadId];

    expect(await as(A.id, () => archiveThreads(A.id, ana, [t1.threadId, t2.threadId, g.id], true))).toBe(2);
    let lista = await as(A.id, () => listThreads(A.id, ana));
    expect(lista.filter((t) => t.archived).map((t) => t.id).sort()).toEqual([t1.threadId, t2.threadId].sort());
    expect(lista.find((t) => t.id === t3.threadId)?.archived).toBe(false);

    // Otra persona de la misma organización no puede archivar ni borrar los de Ana.
    expect(await as(A.id, () => archiveThreads(A.id, beto, ids, true))).toBe(0);
    expect(await as(A.id, () => deleteThreads(A.id, beto, ids))).toBe(0);

    // Preguntar en un hilo archivado lo saca de Archivados.
    await ask(ana, t1.threadId, "de nuevo");
    lista = await as(A.id, () => listThreads(A.id, ana));
    expect(lista.find((t) => t.id === t1.threadId)?.archived).toBe(false);

    expect(await as(A.id, () => archiveThreads(A.id, ana, [t2.threadId], false))).toBe(1);

    // Borrar varios de golpe; el general sobrevive aunque venga en la lista.
    expect(await as(A.id, () => deleteThreads(A.id, ana, [...ids, g.id]))).toBe(3);
    expect(await as(A.id, () => listThreads(A.id, ana))).toEqual([]);
    expect((await as(A.id, () => ensureGeneralThread(A.id, ana))).id).toBe(g.id);
  });
});
