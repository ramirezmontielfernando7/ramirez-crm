import { apiError } from "@/lib/api";
import { withPlatformAdmin } from "@/server/platform-admin/http";
import { listOrganizations } from "@/server/platform-admin/organizations";
import { listOrgsUsage } from "@/server/platform-admin/usage";
import { getPlanCatalog, getPlanProfiles } from "@/server/plan-catalog/store";
import { CATALOG_SCOPES, capsOfPlan } from "@/lib/plan-catalog";
import { runWithOrganization } from "@/lib/request-context";
import { getEffectiveLimits } from "@/server/limits";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 040 — La ficha de UNA organización (lo mismo que su fila de la lista): solo metadatos y números. */
export const GET = withPlatformAdmin(async (_admin, _ip, _req, { params }: Params) => {
  const { id } = await params;
  const org = (await listOrganizations()).find((o) => o.id === id);
  if (!org) return apiError(404, "not_found", "Organización no encontrada");
  const catalog = await getPlanCatalog();
  const [usage, planProfiles, limits] = await Promise.all([
    listOrgsUsage([id]),
    getPlanProfiles(),
    runWithOrganization(id, () => getEffectiveLimits(id)),
  ]);
  // 048: qué trae cada plan HOY (pantalla de funciones y vista previa del
  // cambio de plan) y los topes de personas y almacenamiento de cada plan.
  return Response.json({
    organization: { ...org, usage: usage.get(id) ?? null },
    planProfiles,
    planCaps: Object.fromEntries(CATALOG_SCOPES.map((s) => [s, capsOfPlan(s, catalog)])),
    limits: { members: limits.members.value, storageBytes: limits.storageBytes.value },
  });
});
