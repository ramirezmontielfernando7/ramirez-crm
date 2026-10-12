import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { PLAN_KEYS, STORAGE_MODES } from "@/lib/limits";
import { runWithOrganization } from "@/lib/request-context";
import { getEffectiveLimits } from "@/server/limits";
import { listAlerts } from "@/server/limits/alerts";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";
import { changeOrganizationLimits } from "@/server/platform-admin/organizations";
import { organizationExists } from "@/server/platform-admin/usage";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 036 (PR 3a) — El plan y los topes de UNA organización (cada uno con su
 * origen: propio, del entorno o sin tope) y sus avisos del mes. Solo el
 * administrador de plataforma (404 a los demás).
 */
export const GET = withPlatformAdmin(async (_admin, _ip, _req, { params }: Params) => {
  const { id } = await params;
  if (!(await organizationExists(id))) return apiError(404, "not_found", "Organización no encontrada");
  const [limits, alerts] = await runWithOrganization(id, () =>
    Promise.all([getEffectiveLimits(id), listAlerts(id)])
  );
  return Response.json({ limits, alerts });
});

/** Un tope: entero ≥ 0, o `null` para heredar (del entorno o sin tope). Ausente = no tocar. */
const tope = (max: number) => z.number().int().min(0).max(max).nullable().optional();
const INT = 2_147_483_647;

const schema = z
  .object({
    planKey: z.enum(PLAN_KEYS).optional(),
    aiTurns: tope(INT),
    aiTokens: tope(INT),
    embedTokens: tope(Number.MAX_SAFE_INTEGER),
    members: tope(100_000),
    storageBytes: tope(Number.MAX_SAFE_INTEGER),
    storageMode: z.enum(STORAGE_MODES).optional(),
    modules: tope(12),
    kbMaxDocuments: z.number().int().min(1).max(10_000).nullable().optional(),
    kbMaxChunks: z.number().int().min(1).max(100_000).nullable().optional(),
    kbMaxFileBytes: z.number().int().min(1024).max(50 * 1024 * 1024).nullable().optional(),
  })
  .strict();

/** Cambia el plan y los topes. Bajar uno por debajo del uso no quita nada: solo impide crecer. */
export const PUT = withPlatformAdmin(async (admin, ip, req, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const limits = await changeOrganizationLimits(id, body.data, actorOf(admin), ip);
  const alerts = await runWithOrganization(id, () => listAlerts(id));
  return Response.json({ limits, alerts });
});
