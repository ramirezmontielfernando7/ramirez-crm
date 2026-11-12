/* eslint-disable @typescript-eslint/no-explicit-any -- respuesta JSON sin tipar en la prueba */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sessionContext } from "@/lib/auth/session";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

const auth = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  requireSession: async () => auth.session,
}));

/**
 * Auditoría 2026-11 (Ventas con miles de prospectos): el tablero manda una
 * página por columna, los totales vienen de toda la columna y «Mostrar más»
 * trae la siguiente página sin repetir ni saltarse tarjetas.
 */
describe("tablero de ventas paginado", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let stageId = "";
  const TOTAL = 130;

  beforeAll(async () => {
    A = await crearOrganizacion("Pipeline pág");
    const sys = getSystemDb();
    const [stage] = await sys
      .select()
      .from(schema.pipelineStage)
      .where(and(eq(schema.pipelineStage.organizationId, A.id), eq(schema.pipelineStage.position, 0)));
    stageId = stage!.id;
    const contacts = Array.from({ length: TOTAL }, (_, i) => {
      const tel = `52155${String(10000000 + i)}`;
      return { id: newId("contact"), organizationId: A.id, waIdentity: tel, phone: tel, name: `Prospecto ${i}` };
    });
    await sys.insert(schema.contact).values(contacts);
    await sys.insert(schema.lead).values(
      contacts.map((c, i) => ({
        id: newId("lead"),
        organizationId: A.id,
        contactId: c.id,
        stageId,
        position: i,
        amountCents: i % 2 === 0 ? 10000 : null,
      }))
    );
    auth.session = sessionContext(newId("user"), A.id, "owner");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
  });

  async function board(qs = "") {
    const { GET } = await import("@/app/api/pipeline/board/route");
    return (await (await GET(new Request(`http://localhost/api/pipeline/board${qs}`))).json()) as any;
  }

  it("primera carga: 50 por columna y totales de las 130", async () => {
    const b = await board();
    expect(b.leads).toHaveLength(50);
    expect(b.totals[stageId]).toMatchObject({ count: TOTAL, sinMonto: 65, otraMoneda: 0, totalCents: 65 * 10000 });
  });

  it("«Mostrar más»: páginas seguidas sin repetir ni saltar", async () => {
    const first = await board();
    const second = await board(`?stageId=${stageId}&offset=50&take=50`);
    const third = await board(`?stageId=${stageId}&offset=100&take=50`);
    expect(second.leads).toHaveLength(50);
    expect(third.leads).toHaveLength(30);
    const ids = [...first.leads, ...second.leads, ...third.leads].map((l: any) => l.id);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(first.leads[0].position).toBe(0);
    expect(third.leads.at(-1).position).toBe(TOTAL - 1);
  });

  it("el refresco puede pedir todo lo cargado con take", async () => {
    const b = await board("?take=120");
    expect(b.leads).toHaveLength(120);
  });
});
