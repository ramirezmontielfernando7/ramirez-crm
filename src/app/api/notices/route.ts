import { withAuth } from "@/lib/api";
import { can } from "@/lib/auth/permissions";
import { billingNoticeText } from "@/lib/billing";
import { getBillingState } from "@/server/billing/store";
import { getPlatformContact } from "@/server/plan-catalog/store";
import { getActiveBroadcast } from "@/server/platform-controls/store";

export const dynamic = "force-dynamic";

/**
 * 048 — Los avisos de la plataforma para la franja de arriba: el aviso a
 * todos los clientes (si hay) y el de la prueba gratis o el pago de ESTA
 * organización (sin montos). Cualquier rol con sesión: la IA en pausa la
 * nota todo el equipo. El enlace de WhatsApp para pagar solo va al
 * Propietario (`usage.read`).
 */
export const GET = withAuth(async (session) => {
  const [broadcast, state] = await Promise.all([getActiveBroadcast(), getBillingState(session.organizationId)]);
  const text = billingNoticeText(state);
  const owner = can(session, "usage.read");
  const contact = text && owner ? await getPlatformContact() : null;
  return Response.json({
    broadcast: broadcast ? { id: broadcast.id, message: broadcast.message, level: broadcast.level } : null,
    billing: text ? { kind: state.kind, text, restricted: state.restricted, contactWhatsapp: contact } : null,
  });
});
