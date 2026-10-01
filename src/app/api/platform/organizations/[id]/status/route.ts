import { z } from "zod";
import { parseBody } from "@/lib/api";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";
import { changeOrganizationStatus } from "@/server/platform-admin/organizations";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const schema = z.object({
  action: z.enum(["suspend", "reactivate", "delete", "restore"]),
  reason: z.string().trim().max(300).nullish(),
});

/**
 * Fase 3, PR 2 — Suspender, reactivar, borrar (suave: 30 días de gracia) o
 * restaurar una organización. Suspender o borrar cierra sus sesiones al
 * instante. El borrado definitivo es `scripts/purge-organization.mjs`.
 */
export const POST = withPlatformAdmin(async (admin, ip, req, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const result = await changeOrganizationStatus(id, body.data.action, body.data.reason ?? null, actorOf(admin), ip);
  return Response.json({ status: result.status, purgeAfter: result.purgeAfter?.toISOString() ?? null });
});
