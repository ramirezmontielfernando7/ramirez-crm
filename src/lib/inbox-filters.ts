import { can } from "@/lib/auth/permissions";
import type { ConversationDto } from "@/lib/types";

/**
 * 034 — Reglas puras de la Bandeja: filtro por etiqueta, archivados y quién
 * puede eliminar. Sin React ni BD, para probarlas sin montar nada.
 */

/** Valor del filtro de etiqueta cuando no se filtra ("Toda etiqueta"). */
export const ALL_TAGS = "all";

/** ¿Está archivada? (fuera de la Bandeja principal, pero conservada). */
export function isArchived(c: Pick<ConversationDto, "archivedAt">): boolean {
  return c.archivedAt != null;
}

/** ¿Lleva esta etiqueta? `all` (o vacío) las deja pasar todas. */
export function matchesTag(
  c: Pick<ConversationDto, "tags">,
  tagId: string
): boolean {
  if (!tagId || tagId === ALL_TAGS) return true;
  return c.tags.some((t) => t.id === tagId);
}

/**
 * La vista elegida: la Bandeja principal oculta las archivadas; «Archivados»
 * muestra SOLO ellas.
 */
export function inArchiveView(
  c: Pick<ConversationDto, "archivedAt">,
  showArchived: boolean
): boolean {
  return showArchived ? isArchived(c) : !isArchived(c);
}

/**
 * Eliminar para siempre (Propietario y Coordinador). La UI lo usa para
 * esconder el botón; la ruta lo valida de nuevo en el servidor (403).
 */
export function canDeleteConversation(subject: { role: string }): boolean {
  return can(subject, "conversation.delete");
}
