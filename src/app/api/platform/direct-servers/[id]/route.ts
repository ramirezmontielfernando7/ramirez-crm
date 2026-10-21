import { z } from "zod";
import { parseBody } from "@/lib/api";
import { changeServer, removeServer } from "@/server/platform-admin/direct-servers";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const schema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    baseUrl: z.string().trim().min(1).max(300).optional(),
    apiKey: z.string().trim().min(8).max(500).optional(),
    maxInstances: z.number().int().min(1).max(1000).optional(),
    status: z.enum(["active", "full", "disabled"]).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

/** Conexión directa (PR 1) — Cambiar un servidor (nombre, dirección, llave, capacidad, estado). */
export const PATCH = withPlatformAdmin(async (admin, ip, req, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const server = await changeServer(id, body.data, actorOf(admin), ip);
  return Response.json({ server });
});

/** Borrar un servidor sin empresas (409 si tiene). */
export const DELETE = withPlatformAdmin(async (admin, ip, _req, { params }: Params) => {
  const { id } = await params;
  await removeServer(id, actorOf(admin), ip);
  return new Response(null, { status: 204 });
});
