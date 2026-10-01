import { and, eq, sql } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import { getSystemDb, schema } from "@/lib/db";
import { getSessionOrNull } from "@/lib/auth/session";
import { platformOrgId } from "@/server/platform";
import { recordPlatformAudit } from "./audit";

/**
 * Fase 3, PR 2 — Administrador de PLATAFORMA. No es un rol de organización:
 * es una fila en `platform_admin` (la crea el operador con
 * `scripts/platform-admin.mjs`) Y ser miembro de la organización de la
 * plataforma (`PLATFORM_ORG_ID`). Las dos condiciones: una sola no basta.
 *
 * Para todo lo demás, /platform y /api/platform/* responden 404, igual que
 * si no existieran.
 */

export type PlatformAdmin = { userId: string; email: string; name: string; organizationId: string };

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

/** El administrador de plataforma de la sesión actual, o null (→ 404). */
export async function currentPlatformAdmin(): Promise<PlatformAdmin | null> {
  const platform = platformOrgId();
  if (!platform) return null;
  const session = await getSessionOrNull();
  if (!session || session.organizationId !== platform) return null;
  const [row] = await sys()
    .select({ userId: schema.platformAdmin.userId, email: schema.user.email, name: schema.user.name })
    .from(schema.platformAdmin)
    .innerJoin(schema.user, eq(schema.user.id, schema.platformAdmin.userId))
    .where(eq(schema.platformAdmin.userId, session.userId))
    .limit(1);
  return row ? { ...row, organizationId: platform } : null;
}

/** 3 contraseñas equivocadas seguidas → 15 minutos sin poder generar enlaces. */
export const REAUTH_MAX_FAILURES = 3;
export const REAUTH_LOCK_MS = 15 * 60 * 1000;

export type Reauth = { ok: true } | { ok: false; reason: "wrong_password" | "locked"; lockedUntil?: Date };

/**
 * El administrador vuelve a escribir SU contraseña antes de una acción
 * sensible. Cada fallo cuenta (en la BD) y queda en la bitácora; al tercero,
 * bloqueo temporal. Un acierto pone el contador en cero.
 */
export async function reauthenticate(
  admin: PlatformAdmin,
  password: string,
  ip: string | null,
  now = new Date()
): Promise<Reauth> {
  const [state] = await sys()
    .select({ failed: schema.platformAdmin.failedReauth, lockedUntil: schema.platformAdmin.lockedUntil })
    .from(schema.platformAdmin)
    .where(eq(schema.platformAdmin.userId, admin.userId))
    .limit(1);
  if (!state) return { ok: false, reason: "wrong_password" };
  if (state.lockedUntil && state.lockedUntil > now) {
    return { ok: false, reason: "locked", lockedUntil: state.lockedUntil };
  }

  const [account] = await sys()
    .select({ hash: schema.account.password })
    .from(schema.account)
    .where(and(eq(schema.account.userId, admin.userId), eq(schema.account.providerId, "credential")))
    .limit(1);
  const ok = Boolean(account?.hash) && password.length > 0 && (await verifyPassword({ hash: account!.hash!, password }));

  if (ok) {
    await sys()
      .update(schema.platformAdmin)
      .set({ failedReauth: 0, lockedUntil: null })
      .where(eq(schema.platformAdmin.userId, admin.userId));
    return { ok: true };
  }

  // Atómico: dos intentos a la vez no se pisan el contador.
  const [after] = await sys()
    .update(schema.platformAdmin)
    .set({ failedReauth: sql`${schema.platformAdmin.failedReauth} + 1` })
    .where(eq(schema.platformAdmin.userId, admin.userId))
    .returning({ failed: schema.platformAdmin.failedReauth });
  const actor = { userId: admin.userId, email: admin.email };
  await recordPlatformAudit({ actor, action: "reauth.failed", detail: { intento: after?.failed ?? null }, ip });
  if ((after?.failed ?? 0) >= REAUTH_MAX_FAILURES) {
    const lockedUntil = new Date(now.getTime() + REAUTH_LOCK_MS);
    await sys()
      .update(schema.platformAdmin)
      .set({ failedReauth: 0, lockedUntil })
      .where(eq(schema.platformAdmin.userId, admin.userId));
    await recordPlatformAudit({ actor, action: "reauth.locked", detail: { hasta: lockedUntil.toISOString() }, ip });
    return { ok: false, reason: "locked", lockedUntil };
  }
  return { ok: false, reason: "wrong_password" };
}
