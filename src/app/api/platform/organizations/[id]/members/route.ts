import { withPlatformAdmin } from "@/server/platform-admin/http";
import { listMembers } from "@/server/platform-admin/organizations";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Fase 3, PR 2 — Personas de una organización: nombre, correo y rol. Nada más. */
export const GET = withPlatformAdmin(async (_admin, _ip, _req, { params }: Params) => {
  const { id } = await params;
  return Response.json({ members: await listMembers(id) });
});
