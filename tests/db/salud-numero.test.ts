import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getSystemDb as getDb, schema } from "@/lib/db";
import { runWithOrganization } from "@/lib/request-context";
import { utcDay } from "@/lib/phone-health";
import { getHealthSummary, readRecently, recordHealthEvent } from "@/server/whatsapp/health";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Campañas v2, PR 1 — Salud del número contra Postgres real (sin Meta: los
 * webhooks escriben la fila del día por su cuenta).
 */
describe("salud del número", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let B: Awaited<ReturnType<typeof crearOrganizacion>>;
  beforeAll(async () => {
    A = await crearOrganizacion("Salud A");
    B = await crearOrganizacion("Salud B");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });

  it("los webhooks acumulan en la fila del día sin borrarse entre sí", async () => {
    await runWithOrganization(A.id, () =>
      recordHealthEvent(A.id, "account_update", { event: "ACCOUNT_RESTRICTION" })
    );
    await runWithOrganization(A.id, () =>
      recordHealthEvent(A.id, "phone_number_quality_update", { event: "DOWNGRADE", current_limit: "TIER_250" })
    );
    const rows = await getDb().select().from(schema.waPhoneHealth).where(eq(schema.waPhoneHealth.organizationId, A.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.day).toBe(utcDay());
    expect(rows[0]!.messagingLimitValue).toBe(250);
    expect(rows[0]!.accountEvent).toMatchObject({ event: "ACCOUNT_RESTRICTION" });
    const s = await runWithOrganization(A.id, () => getHealthSummary(A.id));
    expect(s.alerts.map((a) => a.code)).toContain("account_event");
  });

  it("un webhook no cuenta como lectura de Meta (no cambia el origen de una lectura)", async () => {
    await getDb()
      .update(schema.waPhoneHealth)
      .set({ source: "sync", fetchedAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(schema.waPhoneHealth.organizationId, A.id));
    await runWithOrganization(A.id, () =>
      recordHealthEvent(A.id, "phone_number_quality_update", { current_limit: "TIER_1K" })
    );
    const [row] = await getDb().select().from(schema.waPhoneHealth).where(eq(schema.waPhoneHealth.organizationId, A.id));
    expect(row!.source).toBe("sync");
    expect(row!.messagingLimitValue).toBe(1000);
    expect(await runWithOrganization(A.id, () => readRecently(A.id, 60_000))).toBe(false);
  });

  it("una organización no ve la salud de otra", async () => {
    const s = await runWithOrganization(B.id, () => getHealthSummary(B.id));
    expect(s.today).toBeNull();
    expect(s.alerts).toEqual([]);
  });
});
