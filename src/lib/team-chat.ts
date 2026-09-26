/**
 * 025 — Chat de equipo: contratos compartidos entre servidor y cliente, y las
 * reglas PURAS de quién ve y quién escribe (probadas en
 * tests/unit/team-chat-rules.test.ts). Nada de aquí toca la BD.
 */

import type { MentionDto } from "@/lib/team-chat-mentions";

export type TeamThreadKind = "direct" | "group" | "announcements";

/**
 * Cómo se relaciona una persona con un hilo:
 * - `member`: participa (en avisos, todo miembro de la organización).
 * - `oversight`: el Propietario con la supervisión encendida mirando un
 *   directo o grupo ajeno. Solo lectura, no suma a su badge.
 * - null: no lo ve (la API responde 404, igual que si no existiera).
 */
export type ThreadRelation = "member" | "oversight";

/** Largo máximo de un mensaje (validado en el servidor). */
export const TEAM_MESSAGE_MAX = 4000;
/** Largo máximo del nombre de un grupo. */
export const TEAM_GROUP_NAME_MAX = 60;
/** Página del historial: por defecto y tope. */
export const TEAM_PAGE_DEFAULT = 50;
export const TEAM_PAGE_MAX = 100;
/** Adjuntos: tope de tamaño. */
export const TEAM_ATTACHMENT_MAX_BYTES = 16 * 1024 * 1024;
/** Aviso fijo para los miembros cuando la supervisión está visible. */
export const OVERSIGHT_NOTICE = "El Propietario puede supervisar las conversaciones";

export function resolveRelation(input: {
  kind: TeamThreadKind;
  isParticipant: boolean;
  canOversee: boolean;
  oversightOn: boolean;
}): ThreadRelation | null {
  // Avisos: todos los miembros de la organización participan.
  if (input.kind === "announcements" || input.isParticipant) return "member";
  if (input.canOversee && input.oversightOn) return "oversight";
  return null;
}

/**
 * ¿Puede escribir, reaccionar y marcar leído? Solo quien participa; en el
 * canal de avisos, además, quien puede publicar (`team_chat.announce`). La
 * supervisión nunca escribe.
 */
export function canPost(
  relation: ThreadRelation | null,
  kind: TeamThreadKind,
  canAnnounce: boolean
): boolean {
  if (relation !== "member") return false;
  return kind !== "announcements" || canAnnounce;
}

/** ¿Puede reaccionar? Quien participa, también en avisos (leer y reaccionar). */
export function canReact(relation: ThreadRelation | null): boolean {
  return relation === "member";
}

/** Llave única de un directo: los dos ids ordenados. */
export function directKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/** Un emoji de reacción: corto y con al menos un pictograma. */
export function isReactionEmoji(value: string): boolean {
  return value.length > 0 && value.length <= 16 && /\p{Extended_Pictographic}/u.test(value);
}

/* ---------- Adjuntos ---------- */

/** Nunca se aceptan: el navegador los interpretaría como documento activo. */
const BLOCKED_MIME = /^(image\/svg\+xml|text\/html|application\/xhtml\+xml|text\/xml|application\/xml)$/i;
const BLOCKED_EXT = /\.(svg|svgz|html?|xhtml|xht|xml|mht|mhtml)$/i;

/** ¿Se puede subir este archivo? Bloquea SVG y HTML por tipo Y por extensión. */
export function attachmentRejection(mime: string, fileName: string, size: number): string | null {
  if (!/^[\w.-]+\/[\w.+-]+$/.test(mime)) return "Tipo de archivo no reconocido";
  if (BLOCKED_MIME.test(mime) || BLOCKED_EXT.test(fileName)) {
    return "Por seguridad no se aceptan archivos SVG ni HTML";
  }
  if (size <= 0) return "El archivo está vacío";
  if (size > TEAM_ATTACHMENT_MAX_BYTES) return "El archivo pasa de 16 MB";
  return null;
}

/** Solo las imágenes raster se muestran en línea; todo lo demás se descarga. */
export function isInlineImage(mime: string): boolean {
  return /^image\/(jpeg|png|webp|gif)$/i.test(mime);
}

/* ---------- DTOs ---------- */

export type TeamPersonDto = { id: string; name: string; role: string };

export type TeamThreadDto = {
  id: string;
  kind: TeamThreadKind;
  /** Grupo/avisos: su nombre. Directo: el nombre de la otra persona. */
  title: string;
  relation: ThreadRelation;
  /** ¿Puede escribir aquí esta persona? */
  canPost: boolean;
  members: TeamPersonDto[];
  unread: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
};

export type TeamAttachmentDto = {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  inline: boolean;
};

/**
 * Reacción: quién la puso (ids). Sin campos "míos": el mismo mensaje viaja a
 * todos por SSE y cada cliente sabe quién es (`reactedByMe`).
 */
export type TeamReactionDto = { emoji: string; userIds: string[] };

export type TeamMessageDto = {
  id: string;
  threadId: string;
  author: { id: string; name: string } | null;
  /** Con marcadores `@[m:i]` en lugar de las menciones (ver `team-chat-mentions.ts`). */
  body: string;
  /** 026 — Qué ve ESTA persona de cada chat de cliente mencionado. */
  mentions: MentionDto[];
  /** 026 — Llegó neutro (por SSE): pedir la versión propia para resolver menciones. */
  needsResolve: boolean;
  attachment: TeamAttachmentDto | null;
  reactions: TeamReactionDto[];
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
};

/** ¿Es mío este mensaje? (el DTO es el mismo para todos; se decide en el cliente). */
export function isMine(message: Pick<TeamMessageDto, "author">, userId: string): boolean {
  return message.author?.id === userId;
}

export function reactedByMe(reaction: TeamReactionDto, userId: string): boolean {
  return reaction.userIds.includes(userId);
}

export type TeamChatListResponse = {
  threads: TeamThreadDto[];
  /** La supervisión del Propietario está activa y ESTA persona la ejerce. */
  overseeing: boolean;
  /** Mostrar a esta persona "El Propietario puede supervisar las conversaciones". */
  oversightNotice: boolean;
  /** Puede crear grupos (Propietario, o Coordinador con la delegación). */
  canCreateGroups: boolean;
};

export type TeamChatSettingsDto = {
  ownerOversight: boolean;
  showOversightNotice: boolean;
  coordinatorsCanCreateGroups: boolean;
};

/** Suma de no leídos de los hilos donde la persona PARTICIPA (la supervisión no cuenta). */
export function totalUnread(threads: Pick<TeamThreadDto, "relation" | "unread">[]): number {
  return threads.reduce((a, t) => a + (t.relation === "member" ? t.unread : 0), 0);
}
