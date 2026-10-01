import { z } from "zod";
import { parseBody } from "@/lib/api";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";
import { createOrganization, listOrganizations } from "@/server/platform-admin/organizations";

export const dynamic = "force-dynamic";

/** Fase 3, PR 2 — Organizaciones de la plataforma (solo metadatos). */
export const GET = withPlatformAdmin(async () => {
  return Response.json({ organizations: await listOrganizations() });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(1).max(120),
  ownerEmail: z.string().trim().email().max(200),
});

/**
 * Alta de una organización con su primer Propietario. La respuesta trae el
 * enlace de activación UNA sola vez (72 h): no se puede volver a leer.
 */
export const POST = withPlatformAdmin(async (admin, ip, req) => {
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;
  const created = await createOrganization(body.data, actorOf(admin), ip);
  return Response.json(
    { organizationId: created.organizationId, activationUrl: created.activationUrl, expiresAt: created.expiresAt.toISOString() },
    { status: 201 }
  );
});
