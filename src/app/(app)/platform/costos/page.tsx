import { notFound } from "next/navigation";
import { AiModelsClient } from "@/components/platform/ai-models-client";
import { CostsClient } from "@/components/platform/costs-client";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/**
 * 036 (PR 3b) — Plataforma → IA: modelos y costos (ronda 3): las tarjetas
 * del mes arriba, los modelos de la instancia, y «Gasto por empresa» junto a
 * la calculadora. Solo el administrador de plataforma (404 a los demás).
 */
export default async function PlatformCostsPage() {
  if (!(await currentPlatformAdmin())) notFound();
  return (
    <div className="mx-auto max-w-6xl">
      <CostsClient>
        <AiModelsClient />
      </CostsClient>
    </div>
  );
}
