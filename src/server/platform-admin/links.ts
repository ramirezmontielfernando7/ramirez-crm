import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getEnv } from "@/lib/env";
import { runWithOrganization } from "@/lib/request-context";
import { logger } from "@/lib/log";
import { postSystemNotice } from "@/server/team-chat/messages";
import { recordPlatformAudit, type AuditActor } from "./audit";

/**
 * Fase 3, PR 2 — Enlaces de un solo uso para que una persona ponga SU
 * contraseña. Sin correo en el núcleo (constitución II), el enlace lo ve una
 * vez el administrador de plataforma y lo entrega por el canal que quiera.
 *
 * - `activate` (72 h): el primer Propietario de una organización nueva.
 * - `reset` (2 h): restablecimiento que genera el administrador, tras volver
 *   a escribir su propia contraseña (`reauthenticate`).
 *
 * Solo se guarda el SHA-256 del token. Usarlo es atómico (dos pestañas no lo
 * usan dos veces), guarda IP y navegador, cierra todas las sesiones de la
 * persona y queda en la bitácora. Un `reset` además deja un aviso en el canal
 * de Avisos de su organización.
 *
 * Límite documentado: quien entrega el enlace podría usarlo. Lo cierra un
 * correo transaccional (conector opcional, más adelante).
 */

export const LINK_TTL_MS = { activate: 72 * 60 * 60 * 1000, reset: 2 * 60 * 60 * 1000 } as const;
export const MIN_PASSWORD_LENGTH = 8;

export type LinkPurpose = keyof typeof LINK_TTL_MS;

const log = logger("platform");

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function linkUrl(purpose: LinkPurpose, token: string): string {
  const base = getEnv().APP_BASE_URL.replace(/\/+$/, "");
  return `${base}/${purpose === "activate" ? "activar" : "restablecer"}/${token}`;
}

/**
 * Crea el enlace y anula los pendientes de esa persona (solo vale el último).
 * Devuelve la URL UNA vez: no se puede volver a leer.
 */
export async function createAccountLink(
  userId: string,
  purpose: LinkPurpose,
  createdBy: string | null,
  now = new Date()
): Promise<{ url: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + LINK_TTL_MS[purpose]);
  await sys().transaction(async (tx) => {
    await tx
      .update(schema.accountLinkToken)
      .set({ expiresAt: now })
      .where(and(eq(schema.accountLinkToken.userId, userId), isNull(schema.accountLinkToken.usedAt), gt(schema.accountLinkToken.expiresAt, now)));
    await tx.insert(schema.accountLinkToken).values({
      id: newId("accountLinkToken"),
      userId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt,
      createdBy,
    });
  });
  return { url: linkUrl(purpose, token), expiresAt };
}

export type LinkInfo =
  | { ok: true; purpose: LinkPurpose; name: string; emailMasked: string }
  | { ok: false; reason: "invalid" | "used" | "expired" };

/** `ana@ejemplo.com` → `a••@ejemplo.com`: para que la persona reconozca su cuenta. */
export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(user.length - 1, 6)))}@${domain}`;
}

/** Qué es el enlace (sin usarlo): para la pantalla. */
export async function inspectAccountLink(token: string, now = new Date()): Promise<LinkInfo> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { ok: false, reason: "invalid" };
  const [row] = await sys()
    .select({
      purpose: schema.accountLinkToken.purpose,
      usedAt: schema.accountLinkToken.usedAt,
      expiresAt: schema.accountLinkToken.expiresAt,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.accountLinkToken)
    .innerJoin(schema.user, eq(schema.user.id, schema.accountLinkToken.userId))
    .where(eq(schema.accountLinkToken.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return { ok: false, reason: "invalid" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true, purpose: row.purpose, name: row.name, emailMasked: maskEmail(row.email) };
}

export type Consume = { ok: true; purpose: LinkPurpose } | { ok: false; reason: "invalid" | "used" | "expired" | "weak_password" };

/** Usa el enlace: fija la contraseña nueva y lo quema. */
export async function consumeAccountLink(input: {
  token: string;
  password: string;
  ip: string | null;
  userAgent: string | null;
  now?: Date;
}): Promise<Consume> {
  const now = input.now ?? new Date();
  if (input.password.length < MIN_PASSWORD_LENGTH || input.password.length > 128) {
    return { ok: false, reason: "weak_password" };
  }
  const info = await inspectAccountLink(input.token, now);
  if (!info.ok) return info;

  // Se quema ANTES de tocar la contraseña: dos usos a la vez, solo uno gana.
  const [used] = await sys()
    .update(schema.accountLinkToken)
    .set({ usedAt: now, usedIp: input.ip, usedUserAgent: input.userAgent?.slice(0, 300) ?? null })
    .where(
      and(
        eq(schema.accountLinkToken.tokenHash, hashToken(input.token)),
        isNull(schema.accountLinkToken.usedAt),
        gt(schema.accountLinkToken.expiresAt, now)
      )
    )
    .returning({ userId: schema.accountLinkToken.userId, purpose: schema.accountLinkToken.purpose });
  if (!used) return { ok: false, reason: "used" };

  const hash = await hashPassword(input.password);
  await sys().transaction(async (tx) => {
    const [account] = await tx
      .select({ id: schema.account.id })
      .from(schema.account)
      .where(and(eq(schema.account.userId, used.userId), eq(schema.account.providerId, "credential")))
      .limit(1);
    if (account) {
      await tx.update(schema.account).set({ password: hash, updatedAt: now }).where(eq(schema.account.id, account.id));
    } else {
      await tx.insert(schema.account).values({
        id: newId("account"),
        accountId: used.userId,
        providerId: "credential",
        userId: used.userId,
        password: hash,
      });
    }
    // Contraseña nueva: ninguna sesión vieja sigue valiendo.
    await tx.delete(schema.session).where(eq(schema.session.userId, used.userId));
  });

  const [person] = await sys()
    .select({ email: schema.user.email, name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, used.userId))
    .limit(1);
  const [membership] = await sys()
    .select({ organizationId: schema.member.organizationId, orgName: schema.organization.name })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(eq(schema.member.userId, used.userId))
    .orderBy(asc(schema.member.createdAt))
    .limit(1);

  await recordPlatformAudit({
    actor: null,
    action: "link.used",
    org: membership ? { id: membership.organizationId, name: membership.orgName } : null,
    user: { id: used.userId, email: person?.email ?? "" },
    detail: { proposito: used.purpose, navegador: input.userAgent?.slice(0, 120) ?? null },
    ip: input.ip,
  });

  // Un restablecimiento hecho desde la plataforma no pasa en silencio: el
  // equipo (y la persona) lo ven en Avisos. Si falla el aviso, la contraseña
  // ya quedó: se registra y sigue.
  if (used.purpose === "reset" && membership) {
    try {
      await runWithOrganization(membership.organizationId, () =>
        postSystemNotice(
          membership.organizationId,
          `🛡️ Aviso de la plataforma: se restableció la contraseña de ${person?.name ?? "una cuenta"} con un enlace de soporte (${now.toISOString().slice(0, 16).replace("T", " ")} UTC). Si nadie de tu equipo lo pidió, avisa a soporte de la plataforma.`
        )
      );
    } catch (err) {
      log.error("no se pudo publicar el aviso del restablecimiento", { org: membership.organizationId, err });
    }
  }
  return { ok: true, purpose: used.purpose };
}

export type { AuditActor };
