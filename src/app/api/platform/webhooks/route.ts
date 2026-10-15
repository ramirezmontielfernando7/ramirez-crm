import { withPlatformAdmin } from "@/server/platform-admin/http";
import { listUnroutedGroups, UNROUTED_MAX_ROWS, UNROUTED_RETENTION_DAYS } from "@/server/webhooks/unrouted";

export const dynamic = "force-dynamic";

/**
 * 040 — Webhooks sin ruta: lo que llegó firmado por Meta para un número,
 * WABA o página que ninguna organización tiene (o cuya organización no
 * opera), agrupado por llave. Solo metadatos: el contenido no sale.
 */
export const GET = withPlatformAdmin(async () => {
  const { groups, total } = await listUnroutedGroups();
  return Response.json({
    groups: groups.map((g) => ({ ...g, firstAt: g.firstAt.toISOString(), lastAt: g.lastAt.toISOString() })),
    total,
    retentionDays: UNROUTED_RETENTION_DAYS,
    maxRows: UNROUTED_MAX_ROWS,
  });
});
