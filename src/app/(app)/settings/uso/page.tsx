import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

/**
 * «Uso y plan» es una ventana (`UsageDialog`): esta dirección la abre sobre la
 * Bandeja. Solo el Propietario (`usage.read`); los demás vuelven a la Bandeja.
 */
export default async function UsagePlanPage() {
  await requirePagePermission("usage.read");
  redirect("/inbox?uso=1");
}
