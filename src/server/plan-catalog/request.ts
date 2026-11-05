import { eq } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import type { CatalogScope } from "@/lib/plan-catalog";
import { recordPlatformAudit } from "@/server/platform-admin/audit";

/**
 * El Propietario pide cambiar de plan desde «Mejora tu plan». Sin cobro real
 * (cobro manual): la solicitud queda en la bitácora de plataforma
 * («plan.requested», con la organización y quién la pidió) para que el
 * administrador la atienda. Solo metadatos: nunca contenido del negocio.
 */
export async function requestPlanChange(input: {
  organizationId: string;
  userId: string;
  plan: CatalogScope;
  billing: "monthly" | "yearly";
  ip: string | null;
}): Promise<void> {
  const db = getSystemDb();
  const [org] = await db.select({ id: schema.organization.id, name: schema.organization.name }).from(schema.organization).where(eq(schema.organization.id, input.organizationId)).limit(1);
  const [who] = await db.select({ id: schema.user.id, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, input.userId)).limit(1);
  await recordPlatformAudit({
    actor: null,
    action: "plan.requested",
    org: org ?? { id: input.organizationId, name: "(sin nombre)" },
    user: who ?? null,
    detail: { plan: input.plan, cobro: input.billing === "yearly" ? "anual" : "mensual" },
    ip: input.ip,
  });
}
