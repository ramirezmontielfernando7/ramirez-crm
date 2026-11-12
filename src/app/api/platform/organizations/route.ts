import { z } from "zod";
import { PLAN_OPTIONS } from "@/lib/modules/registry";
import { parseBody } from "@/lib/api";
import { actorOf, withPlatformAdmin } from "@/server/platform-admin/http";
import { createOrganization, listOrganizations } from "@/server/platform-admin/organizations";
import { listOrgsUsage } from "@/server/platform-admin/usage";
import { listHealthSignals } from "@/server/platform-admin/health";
import { getManyBillingRows } from "@/server/billing/store";
import { billingState } from "@/lib/billing";
import { healthOf } from "@/lib/platform-health";

export const dynamic = "force-dynamic";

/**
 * Fase 3, PR 2 — Organizaciones de la plataforma (solo metadatos). 036 (PR 4):
 * cada una con su consumo del mes (IA contra su tope y almacenamiento
 * aproximado), en lecturas agrupadas: la lista no se hace más lenta con más
 * organizaciones.
 */
export const GET = withPlatformAdmin(async () => {
  const organizations = await listOrganizations();
  const ids = organizations.map((o) => o.id);
  const now = new Date();
  // 048: el semáforo y el estado del cobro de cada una, también agrupados.
  const [usage, signals, billing] = await Promise.all([listOrgsUsage(ids, now), listHealthSignals(ids, now), getManyBillingRows()]);
  return Response.json({
    organizations: organizations.map((o) => {
      const u = usage.get(o.id) ?? null;
      const b = billing.get(o.id);
      const state = billingState(o.isPlatform || !b ? null : { trialEndsAt: b.trialEndsAt, paidUntil: b.paidUntil, graceDays: b.graceDays }, now);
      const s = signals.get(o.id);
      const health = healthOf(
        {
          status: o.status,
          isPlatform: o.isPlatform,
          createdAt: new Date(o.createdAt),
          whatsappConnected: o.whatsappConnected,
          agentModule: o.modules.agent,
          agentOn: s?.agentOn ?? false,
          lastMessageAt: s?.lastMessageAt ?? null,
          lastLoginAt: s?.lastLoginAt ?? null,
          sent7d: s?.sent7d ?? 0,
          failed7d: s?.failed7d ?? 0,
          aiPct: u?.ai.usdLimit ? (u.ai.estUsd / u.ai.usdLimit) * 100 : null,
          billingKind: state.kind,
          billingRestricted: state.restricted,
        },
        now
      );
      return {
        ...o,
        usage: u,
        billing: { kind: state.kind, daysLeft: state.daysLeft, until: state.until },
        health: { ...health, lastMessageAt: s?.lastMessageAt?.toISOString() ?? null, lastLoginAt: s?.lastLoginAt?.toISOString() ?? null },
      };
    }),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(1).max(120),
  ownerEmail: z.string().trim().email().max(200),
  // 039: plan comercial del alta (plantilla de los 13 interruptores);
  // «personalizado» o sin él, los del entorno y los 13 a mano.
  profile: z.enum(PLAN_OPTIONS).optional(),
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
