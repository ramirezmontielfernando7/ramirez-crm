import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { getOnboarding, setOnboardingHidden } from "@/server/onboarding";

export const dynamic = "force-dynamic";

/**
 * Auditoría UX 2026-11 (paquete A) — «Primeros pasos» y el aviso de «aún no
 * conectas tu WhatsApp». Sin datos de clientes: cualquier rol con sesión (el
 * aviso también lo ve el equipo); la guía solo se le enseña al Propietario.
 */
export const GET = withAuth(async (session) => {
  return Response.json(await getOnboarding(session));
});

const bodySchema = z.object({ hidden: z.boolean() });

export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  await setOnboardingHidden(session.organizationId, body.data.hidden);
  return Response.json({ ok: true });
}, { permission: "settings.manage" });
