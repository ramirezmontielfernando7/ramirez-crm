import { desc, eq } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * Fase 3, PR 2 — Bitácora de plataforma: quién (administrador) hizo qué,
 * sobre qué organización o usuario, cuándo y desde dónde. Solo el pool de
 * sistema; nunca guarda secretos, contraseñas ni enlaces (de un enlace solo
 * queda que se generó y, después, que se usó).
 */

type AuditAction =
  | "organization.created"
  | "organization.suspended"
  | "organization.reactivated"
  | "organization.deleted"
  | "organization.restored"
  | "organization.purged"
  | "organization.modules_changed"
  | "organization.limits_changed"
  | "pricing.changed"
  | "ai_settings.changed"
  | "plans.changed"
  | "plan.requested"
  | "organization.ai_changed"
  | "link.activation_created"
  | "link.reset_created"
  | "link.used"
  | "reauth.failed"
  | "reauth.locked"
  | "admin.added"
  | "admin.removed"
  | "direct_server.added"
  | "direct_server.changed"
  | "direct_server.removed"
  | "direct_connection.server_assigned"
  | "direct_connection.ai_changed"
  // 048: cobro a mano, prueba gratis, interruptores de emergencia y aviso a todos.
  | "billing.trial_changed"
  | "billing.settings_changed"
  | "billing.payment_recorded"
  | "controls.kill_switch_changed"
  | "controls.broadcast_started"
  | "controls.broadcast_ended";

export type AuditActor = { userId: string; email: string } | null;

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

export async function recordPlatformAudit(input: {
  actor: AuditActor;
  action: AuditAction;
  org?: { id: string; name: string } | null;
  user?: { id: string; email: string } | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  await sys()
    .insert(schema.platformAuditLog)
    .values({
      id: newId("platformAudit"),
      actorUserId: input.actor?.userId ?? null,
      actorEmail: input.actor?.email ?? null,
      action: input.action,
      targetOrgId: input.org?.id ?? null,
      targetOrgName: input.org?.name ?? null,
      targetUserId: input.user?.id ?? null,
      targetUserEmail: input.user?.email ?? null,
      detail: input.detail ?? null,
      ip: input.ip ?? null,
    });
}

type AuditEntry = typeof schema.platformAuditLog.$inferSelect;

/** Lo más reciente primero; de una organización o de toda la plataforma. */
export async function listPlatformAudit(opts: { organizationId?: string; limit?: number } = {}): Promise<AuditEntry[]> {
  const q = sys().select().from(schema.platformAuditLog);
  const filtered = opts.organizationId ? q.where(eq(schema.platformAuditLog.targetOrgId, opts.organizationId)) : q;
  return filtered.orderBy(desc(schema.platformAuditLog.at)).limit(Math.min(opts.limit ?? 100, 500));
}
