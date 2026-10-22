import { z } from "zod";
import { parseBody } from "@/lib/api";
import { assignOrganizationServer, organizationDirect } from "@/server/platform-admin/direct-servers";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Conexión directa (PR 2) — El servidor asignado a una organización y su estado (solo metadatos). */
export const GET = withPlatformAdmin(async (_admin, _ip, _req, { params }: Params) => {
  const { id } = await params;
  return Response.json({ connection: await organizationDirect(id) });
});

const schema = z.object({ serverId: z.string().trim().min(1).max(64) }).strict();

/** Asignar (o cambiar, mientras no haya dispositivo vinculado) el servidor de una organización. */
export const PUT = withPlatformAdmin(async (admin, ip, req, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  return Response.json({ connection: await assignOrganizationServer(id, body.data.serverId, actorOf(admin), ip) });
});
