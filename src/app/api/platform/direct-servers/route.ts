import { z } from "zod";
import { parseBody } from "@/lib/api";
import { addServer, listServers } from "@/server/platform-admin/direct-servers";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";

export const dynamic = "force-dynamic";

/**
 * Conexión directa (PR 1) — Servidores del dispositivo vinculado. Solo el
 * administrador de plataforma (404 a los demás). La llave nunca regresa:
 * solo sus últimos 4.
 */
export const GET = withPlatformAdmin(async () => {
  return Response.json({ servers: await listServers() });
});

const schema = z
  .object({
    name: z.string().trim().min(1).max(80),
    baseUrl: z.string().trim().min(1).max(300),
    apiKey: z.string().trim().min(8).max(500),
    maxInstances: z.number().int().min(1).max(1000).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const POST = withPlatformAdmin(async (admin, ip, req) => {
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const server = await addServer(body.data, actorOf(admin), ip);
  return Response.json({ server }, { status: 201 });
});
