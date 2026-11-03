import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { messagesSentLastDay, reserveDailySend, settleDailySend } from "@/server/ai-connector/log";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Auditoría DF-07 — el tope diario de envíos de la IA conectada se reserva
 * de forma atómica y lo comparten TODAS las herramientas que envían (y los
 * procesos: el candado es de PostgreSQL).
 */

describe("DF-07: tope diario compartido y atómico", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  const userId = newId("user");
  const as = <T>(fn: () => Promise<T>) => runWithOrganization(A.id, fn);
  const base = () => ({ organizationId: A.id, userId, connectionId: "aic_prueba", conversationId: "cv_x", contactId: "ct_x" });

  beforeAll(async () => {
    A = await crearOrganizacion("Tope IA A");
    await getSystemDb().insert(schema.user).values({ id: userId, name: "Ana", email: `${userId}@tope.test`, emailVerified: true });
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id]);
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, userId));
  });

  it("límite 1 y tres herramientas distintas a la vez: solo una reserva pasa", async () => {
    const tools = ["send_message", "send_template", "send_material"] as const;
    const rs = await Promise.all(tools.map((tool) => as(() => reserveDailySend({ ...base(), tool, limit: 1 }))));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await as(() => messagesSentLastDay(A.id, userId))).toBe(1);
  });

  it("un envío que falló libera su lugar; uno que salió lo conserva", async () => {
    await getSystemDb().delete(schema.aiActionLog).where(eq(schema.aiActionLog.organizationId, A.id));
    const r1 = await as(() => reserveDailySend({ ...base(), tool: "send_message", limit: 2 }));
    const r2 = await as(() => reserveDailySend({ ...base(), tool: "send_template", limit: 2 }));
    expect(r1.ok && r2.ok).toBe(true);
    expect((await as(() => reserveDailySend({ ...base(), tool: "send_material", limit: 2 }))).ok).toBe(false);
    if (!r1.ok || !r2.ok) throw new Error("reservas");
    await as(() => settleDailySend(A.id, r1.reservationId, { outcome: "error", summary: "no se envió" }));
    await as(() => settleDailySend(A.id, r2.reservationId, { outcome: "ok", summary: "envió 4 caracteres" }));
    expect(await as(() => messagesSentLastDay(A.id, userId))).toBe(1);
    const r3 = await as(() => reserveDailySend({ ...base(), tool: "send_material", limit: 2 }));
    expect(r3.ok).toBe(true);
    // Una sola fila por envío en la bitácora (la reserva), con su resultado.
    const filas = await getSystemDb()
      .select()
      .from(schema.aiActionLog)
      .where(and(eq(schema.aiActionLog.organizationId, A.id), eq(schema.aiActionLog.userId, userId)));
    expect(filas).toHaveLength(3);
    expect(filas.find((f) => f.id === r2.reservationId)?.summary).toBe("envió 4 caracteres");
  });
});
