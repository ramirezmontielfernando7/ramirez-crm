import { desc, eq } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { Pricing, PricingInput } from "@/lib/costs";
import { recordPlatformAudit, type AuditActor } from "@/server/platform-admin/audit";

/**
 * 036 (PR 3b) — Precios de IA de la plataforma (`platform_ai_pricing`, tabla
 * de PLATAFORMA, sin organización): USD por millón de tokens del modelo
 * principal, del juez y de embeddings, más el tipo de cambio a la moneda
 * local. Cada cambio es una fila NUEVA con su «vigente desde»: el historial
 * nunca se reescribe, así que un mes ya cerrado se sigue estimando con el
 * precio que regía entonces. Solo el administrador de plataforma.
 */

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

function toPricing(r: typeof schema.platformAiPricing.$inferSelect, email: string | null): Pricing {
  return {
    id: r.id,
    validFrom: r.validFrom.toISOString(),
    chatInputUsdPerMtok: Number(r.chatInputUsdPerMtok),
    chatOutputUsdPerMtok: Number(r.chatOutputUsdPerMtok),
    judgeInputUsdPerMtok: num(r.judgeInputUsdPerMtok),
    judgeOutputUsdPerMtok: num(r.judgeOutputUsdPerMtok),
    embedUsdPerMtok: Number(r.embedUsdPerMtok),
    usdToLocal: Number(r.usdToLocal),
    localCurrency: r.localCurrency,
    createdAt: r.createdAt.toISOString(),
    createdByEmail: email,
  };
}

/** El historial completo, lo más reciente primero (son pocas filas: una por cambio). */
export async function listPricing(): Promise<Pricing[]> {
  const rows = await sys()
    .select({ p: schema.platformAiPricing, email: schema.user.email })
    .from(schema.platformAiPricing)
    .leftJoin(schema.user, eq(schema.user.id, schema.platformAiPricing.createdBy))
    .orderBy(desc(schema.platformAiPricing.validFrom), desc(schema.platformAiPricing.createdAt))
    .limit(200);
  return rows.map((r) => toPricing(r.p, r.email));
}

/** Agrega un precio nuevo (con su «vigente desde») y lo deja en la bitácora. */
export async function addPricing(
  input: PricingInput,
  actor: AuditActor,
  ip: string | null,
  now = new Date()
): Promise<Pricing> {
  const validFrom = input.validFrom ? new Date(`${input.validFrom}T00:00:00.000Z`) : now;
  const [row] = await sys()
    .insert(schema.platformAiPricing)
    .values({
      id: newId("aiPricing"),
      validFrom,
      chatInputUsdPerMtok: String(input.chatInputUsdPerMtok),
      chatOutputUsdPerMtok: String(input.chatOutputUsdPerMtok),
      judgeInputUsdPerMtok: input.judgeInputUsdPerMtok === null ? null : String(input.judgeInputUsdPerMtok),
      judgeOutputUsdPerMtok: input.judgeOutputUsdPerMtok === null ? null : String(input.judgeOutputUsdPerMtok),
      embedUsdPerMtok: String(input.embedUsdPerMtok),
      usdToLocal: String(input.usdToLocal),
      localCurrency: input.localCurrency,
      createdBy: actor?.userId ?? null,
    })
    .returning();
  await recordPlatformAudit({
    actor,
    action: "pricing.changed",
    detail: { ...input, validFrom: validFrom.toISOString() },
    ip,
  });
  return toPricing(row!, actor?.email ?? null);
}
