import { z } from "zod";
import { parseBody } from "@/lib/api";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";
import { changeOrganizationModules } from "@/server/platform-admin/organizations";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const schema = z
  .object({
    campaigns: z.boolean().optional(),
    agenda: z.boolean().optional(),
    atribucion: z.boolean().optional(),
    instagram: z.boolean().optional(),
    messenger: z.boolean().optional(),
    // Nulo: vuelve a seguir a CAMPAIGN_SEND_RATE (o 10).
    campaignSendRate: z.number().int().min(1).max(80).nullable().optional(),
  })
  .strict();

/**
 * Fase 3, PR 3 — Encender o apagar los módulos opcionales de una organización
 * (Campañas, Agenda, Atribución, Instagram, Messenger) y el ritmo de sus
 * campañas. Solo el administrador de plataforma (404 a los demás); cada
 * cambio queda en la bitácora.
 */
export const POST = withPlatformAdmin(async (admin, ip, req, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const modules = await changeOrganizationModules(id, body.data, actorOf(admin), ip);
  return Response.json({ modules });
});
