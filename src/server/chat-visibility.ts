import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { runWithOrganization } from "@/lib/request-context";
import { logger } from "@/lib/log";
import { DEFAULT_CHAT_VIEW, normalizeChatView, type ChatView } from "@/lib/chat-visibility";

const log = logger("chat-visibility");

/**
 * Qué chats ve un asesor (`organization.metadata.chatVisibility`, sin
 * migración). Se lee en cada sesión, así que se guarda 15 s en memoria por
 * organización; cambiarlo lo limpia al instante en este proceso.
 */
const TTL_MS = 15_000;
const cache = new Map<string, { view: ChatView; at: number }>();

function parseMetadata(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed = JSON.parse(metadata) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Ante cualquier fallo, lo de siempre (solo los suyos): jamás se abre de más. */
export async function getChatView(organizationId: string): Promise<ChatView> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.view;
  try {
    const rows = await runWithOrganization(organizationId, () =>
      getDb()
        .select({ metadata: schema.organization.metadata })
        .from(schema.organization)
        .where(eq(schema.organization.id, organizationId))
        .limit(1)
    );
    const view = normalizeChatView(parseMetadata(rows[0]?.metadata ?? null).chatVisibility);
    cache.set(organizationId, { view, at: Date.now() });
    return view;
  } catch (err) {
    log.error("no se pudo leer qué chats ven los asesores", { org: organizationId, err });
    return DEFAULT_CHAT_VIEW;
  }
}

/** Guarda el ajuste y conserva el resto del JSON de la organización. */
export async function saveChatView(organizationId: string, view: ChatView): Promise<ChatView> {
  const db = getDb();
  const rows = await db
    .select({ metadata: schema.organization.metadata })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const meta = parseMetadata(rows[0]?.metadata ?? null);
  meta.chatVisibility = view;
  await db
    .update(schema.organization)
    .set({ metadata: JSON.stringify(meta) })
    .where(eq(schema.organization.id, organizationId));
  cache.set(organizationId, { view, at: Date.now() });
  return view;
}
