import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { UPLOAD_LINK_MAX_FILES, UPLOAD_LINK_TTL_MS, uploadLinkState, type UploadLinkState } from "@/lib/ai-connector";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getEnv } from "@/lib/env";
import { hashToken } from "@/server/ai-connector/keys";

/**
 * 047 — Enlace de subida de un solo uso. La IA conectada no puede mandar los
 * bytes de un PDF por una herramienta: pide un enlace (`create_upload_link`)
 * y la PERSONA abre `/subir/<token>` con su sesión del CRM y sube ahí sus
 * archivos a la Biblioteca, con las etiquetas y los destinos que la IA
 * propuso. Solo se guarda el SHA-256 del token; el enlace solo lo abre quien
 * lo pidió (misma organización y misma persona), vive un día, recibe a lo
 * más `UPLOAD_LINK_MAX_FILES` archivos y se cierra con «Listo».
 * ÚNICA puerta de `ai_upload_link`.
 */

export type UploadLink = typeof schema.aiUploadLink.$inferSelect;

export type UploadLinkOptions = {
  note: string | null;
  tags: string[];
  inChat: boolean;
  rag: boolean;
  /** `null` = General. */
  ragGroupId: string | null;
};

export function uploadLinkUrl(token: string): string {
  return `${getEnv().APP_BASE_URL.replace(/\/+$/, "")}/subir/${token}`;
}

export async function createUploadLink(input: {
  organizationId: string;
  userId: string;
  connectionId: string | null;
} & UploadLinkOptions, now = new Date()): Promise<{ id: string; url: string; expiresAt: Date }> {
  const token = randomBytes(24).toString("base64url");
  const id = newId("aiUploadLink");
  const expiresAt = new Date(now.getTime() + UPLOAD_LINK_TTL_MS);
  await getDb()
    .insert(schema.aiUploadLink)
    .values({
      id,
      organizationId: input.organizationId,
      userId: input.userId,
      connectionId: input.connectionId,
      tokenHash: hashToken(token),
      note: input.note,
      tags: input.tags,
      inChat: input.inChat,
      rag: input.rag,
      ragGroupId: input.ragGroupId,
      expiresAt,
    });
  return { id, url: uploadLinkUrl(token), expiresAt };
}

/** El enlace de este token, solo si es de quien lo abre. */
export async function findUploadLink(organizationId: string, userId: string, token: string): Promise<UploadLink | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [row] = await getDb()
    .select()
    .from(schema.aiUploadLink)
    .where(
      scoped(
        schema.aiUploadLink.organizationId,
        organizationId,
        eq(schema.aiUploadLink.tokenHash, hashToken(token)),
        eq(schema.aiUploadLink.userId, userId)
      )
    )
    .limit(1);
  return row ?? null;
}

/** Para la herramienta: por id, solo los de esta persona. */
export async function getUploadLink(organizationId: string, userId: string, id: string): Promise<UploadLink | null> {
  const [row] = await getDb()
    .select()
    .from(schema.aiUploadLink)
    .where(
      scoped(
        schema.aiUploadLink.organizationId,
        organizationId,
        eq(schema.aiUploadLink.id, id),
        eq(schema.aiUploadLink.userId, userId)
      )
    )
    .limit(1);
  return row ?? null;
}

export function stateOf(link: UploadLink, now = new Date()): UploadLinkState {
  return uploadLinkState({ expiresAt: link.expiresAt, usedAt: link.usedAt, entryCount: link.entryIds.length }, now);
}

/**
 * Apunta una entrada nueva en el enlace. Atómico: si mientras tanto se cerró,
 * venció o se llenó, no la apunta y devuelve false.
 */
export async function attachEntry(organizationId: string, linkId: string, entryId: string): Promise<boolean> {
  const rows = await getDb()
    .update(schema.aiUploadLink)
    .set({ entryIds: sql`array_append(${schema.aiUploadLink.entryIds}, ${entryId})` })
    .where(
      scoped(
        schema.aiUploadLink.organizationId,
        organizationId,
        eq(schema.aiUploadLink.id, linkId),
        sql`${schema.aiUploadLink.usedAt} is null`,
        sql`${schema.aiUploadLink.expiresAt} > now()`,
        sql`cardinality(${schema.aiUploadLink.entryIds}) < ${UPLOAD_LINK_MAX_FILES}`
      )
    )
    .returning({ id: schema.aiUploadLink.id });
  return rows.length > 0;
}

/** «Listo»: el enlace ya no recibe más. Idempotente. */
export async function closeUploadLink(organizationId: string, linkId: string, now = new Date()): Promise<void> {
  await getDb()
    .update(schema.aiUploadLink)
    .set({ usedAt: now })
    .where(
      scoped(
        schema.aiUploadLink.organizationId,
        organizationId,
        and(eq(schema.aiUploadLink.id, linkId), sql`${schema.aiUploadLink.usedAt} is null`)
      )
    );
}
