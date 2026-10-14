import { UsagePlanClient } from "@/components/usage/usage-plan-client";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

/**
 * 036 (PR 6) → 039 — Ajustes → «Uso y plan»: el consumo del mes de la
 * organización contra sus topes. Solo el Propietario (`usage.read`); los
 * demás vuelven a la Bandeja (la API ya responde 403). /uso redirige aquí.
 */
export default async function UsagePlanPage() {
  await requirePagePermission("usage.read");
  return <UsagePlanClient />;
}
