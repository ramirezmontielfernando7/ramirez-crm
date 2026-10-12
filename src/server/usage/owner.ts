import { countActiveModules } from "@/lib/platform-modules";
import type { EffectiveLimits } from "@/lib/limits";
import { alertText } from "@/lib/limits";
import { embedTokensUsed } from "@/server/ai-quota/quota";
import { orgHasKbDocs } from "@/server/kb-docs/flag";
import { getUsage as getKbDocUsage } from "@/server/kb-docs/store";
import { countMembers, getEffectiveLimits, moduleToggles } from "@/server/limits";
import { listAlerts, type UsageAlertDto } from "@/server/limits/alerts";
import { getOrgModules } from "@/server/modules";
import { readOrgUsageDetail, type OrgUsageDetail } from "./detail";

/**
 * 036 (PR 6) — «Uso y plan» del Propietario: lo que su organización consume
 * este mes contra sus topes (IA, embeddings, almacenamiento aprox.,
 * documentos del agente, personas y módulos), qué función y qué agente
 * consumen más, y los avisos del mes. Solo lectura, a nombre de SU
 * organización (pool de la app, RLS, `scoped()`): nunca ve otra. Sin costos
 * ni precios: eso es del administrador de plataforma.
 */

export type OwnerUsage = OrgUsageDetail & {
  limits: EffectiveLimits;
  embedTokens: number;
  /** `null` si la organización no usa documentos (instancia sin KB_DOCS o sin Laboratorio). */
  documents: { documents: number; chunks: number } | null;
  members: number;
  modules: { active: number; total: number };
  alerts: (UsageAlertDto & { text: string })[];
};

export async function getOwnerUsage(organizationId: string, now = new Date()): Promise<OwnerUsage> {
  // Una tras otra: son pocas lecturas pequeñas y así un fallo no deja
  // promesas sin manejar.
  const detail = await readOrgUsageDetail(organizationId, now);
  const limits = await getEffectiveLimits(organizationId);
  const embedTokens = await embedTokensUsed(organizationId, now);
  const documents = (await orgHasKbDocs(organizationId)) ? await getKbDocUsage(organizationId) : null;
  const members = await countMembers(organizationId);
  const modules = countActiveModules(moduleToggles(await getOrgModules(organizationId)));
  const alerts = (await listAlerts(organizationId, { now })).map((a) => ({ ...a, text: alertText(a.metric, a.threshold) }));
  return { ...detail, limits, embedTokens, documents, members, modules, alerts };
}
