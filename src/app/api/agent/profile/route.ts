import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isAiConfigured } from "@/lib/env";
import { getLegacyProfile, putLegacyProfile } from "@/server/agents/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * El agente GENERAL visto desde `/agent` (que existe aunque el Laboratorio
 * esté apagado). 031: mismo contrato de siempre, solo crece — `displayName`
 * (null = sin nombre propio; `name` sigue diciendo lo que ve el cerebro
 * externo) y `hasUnpublishedDraft` (hay cambios del Laboratorio sin publicar,
 * que guardar aquí reemplaza).
 */
export const GET = withAuth(async (session) => {
  const off = await moduleOff(session.organizationId, "agent");
  if (off) return off;
  const p = await getLegacyProfile(session.organizationId);
  if (!p) return apiError(404, "not_found", "Perfil del agente no encontrado");
  return Response.json({
    profile: {
      enabled: p.enabled,
      name: p.name,
      tone: p.tone,
      instructions: p.instructions,
      escalationRules: p.escalationRules,
      greeting: p.greeting,
      displayName: p.displayName,
      hasUnpublishedDraft: p.hasUnpublishedDraft,
    },
    aiConfigured: isAiConfigured(),
  });
}, { permission: "agent.manage" });

const putSchema = z.object({
  enabled: z.boolean().optional(),
  /** 031: `null` = el agente no se presenta con un nombre propio. */
  name: z.string().trim().min(1).max(60).nullable().optional(),
  tone: z.string().max(500).nullable().optional(),
  instructions: z.string().max(8000).nullable().optional(),
  escalationRules: z.string().max(4000).nullable().optional(),
  greeting: z.string().max(1000).nullable().optional(),
});

/** Guardar aquí = publicar el general (como siempre). */
export const PUT = withAuth(async (session, req: Request) => {
  const off = await moduleOff(session.organizationId, "agent");
  if (off) return off;
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const ok = await putLegacyProfile(session.organizationId, session.userId, body.data);
  if (!ok) return apiError(404, "not_found", "Perfil no encontrado");
  return Response.json({ ok: true });
}, { permission: "agent.manage" });
