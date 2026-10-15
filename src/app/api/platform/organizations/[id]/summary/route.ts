import { apiError } from "@/lib/api";
import { withPlatformAdmin } from "@/server/platform-admin/http";
import { listOrganizations } from "@/server/platform-admin/organizations";
import { listOrgsUsage } from "@/server/platform-admin/usage";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 040 — La ficha de UNA organización (lo mismo que su fila de la lista): solo metadatos y números. */
export const GET = withPlatformAdmin(async (_admin, _ip, _req, { params }: Params) => {
  const { id } = await params;
  const org = (await listOrganizations()).find((o) => o.id === id);
  if (!org) return apiError(404, "not_found", "Organización no encontrada");
  const usage = await listOrgsUsage([id]);
  return Response.json({ organization: { ...org, usage: usage.get(id) ?? null } });
});
