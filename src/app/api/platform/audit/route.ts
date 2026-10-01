import { listPlatformAudit } from "@/server/platform-admin/audit";
import { withPlatformAdmin } from "@/server/platform-admin/http";

export const dynamic = "force-dynamic";

/** Fase 3, PR 2 — Bitácora de plataforma (solo administradores). `?org=` filtra. */
export const GET = withPlatformAdmin(async (_admin, _ip, req) => {
  const org = new URL(req.url).searchParams.get("org") ?? undefined;
  const entries = await listPlatformAudit({ organizationId: org, limit: 200 });
  return Response.json({
    entries: entries.map((e) => ({ ...e, at: e.at.toISOString() })),
  });
});
