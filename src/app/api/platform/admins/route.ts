import { listPlatformAdmins } from "@/server/platform-admin/admins";
import { withPlatformAdmin } from "@/server/platform-admin/http";

export const dynamic = "force-dynamic";

/** 040 — Los administradores de plataforma (solo lectura; los da el operador con su script). */
export const GET = withPlatformAdmin(async () => {
  const admins = await listPlatformAdmins();
  return Response.json({
    admins: admins.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
      lockedUntil: a.lockedUntil && a.lockedUntil > new Date() ? a.lockedUntil.toISOString() : null,
    })),
  });
});
