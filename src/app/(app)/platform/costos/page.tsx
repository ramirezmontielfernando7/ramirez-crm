import { notFound } from "next/navigation";
import { CostsClient } from "@/components/platform/costs-client";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/**
 * 036 (PR 3b) — Plataforma → Costos: cuánto cuesta la IA de cada
 * organización este mes (estimado y real), su proyección, en USD y en la
 * moneda local, y los precios con su historial. Solo el administrador de
 * plataforma (404 a los demás).
 */
export default async function PlatformCostsPage() {
  if (!(await currentPlatformAdmin())) notFound();
  return <CostsClient />;
}
