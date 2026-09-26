import { sendMediaMessage, sendText } from "@/server/inbox/send";
import type { SessionContext } from "@/lib/auth/session";
import { TEAM_MESSAGE_MAX } from "@/lib/team-chat";
import { postMessage } from "@/server/team-chat/messages";
import { readKnowledgeFile, type KnowledgeRow } from "./store";

/**
 * 024 — Entregar una entrada de Conocimientos a un DESTINO.
 *
 * Hoy el único destino es una conversación de WhatsApp (y los canales que
 * comparten su envío): se reutiliza `sendText`/`sendMediaMessage`, así que
 * valen igual la sandbox del Laboratorio, la ventana de 24 h y los límites
 * de adjuntos.
 *
 * 025 — Segundo destino: un hilo del chat de EQUIPO (`internal_chat`). Va
 * por `postMessage` del chat, así que valen su acceso por membresía (404 si
 * no participa), la supervisión de solo lectura y sus límites de adjuntos.
 * El selector de la UI (`KnowledgePicker`) es el mismo para los dos.
 */
export type KnowledgeTarget =
  | {
      kind: "whatsapp_conversation";
      organizationId: string;
      conversationId: string;
    }
  | {
      kind: "internal_chat";
      session: SessionContext;
      threadId: string;
    };

export type KnowledgeSendMode = "text" | "file";

export class KnowledgeDeliveryError extends Error {
  code: "no_text" | "no_file";
  constructor(code: KnowledgeDeliveryError["code"], message: string) {
    super(message);
    this.name = "KnowledgeDeliveryError";
    this.code = code;
  }
}

/** Pie del archivo: el texto de la entrada si cabe en un pie de WhatsApp. */
const CAPTION_MAX = 1024;

export async function deliverKnowledgeEntry(
  target: KnowledgeTarget,
  entry: KnowledgeRow,
  mode: KnowledgeSendMode
): Promise<{ messageId: string }> {
  switch (target.kind) {
    case "whatsapp_conversation": {
      if (mode === "text") {
        const text = entry.body.trim();
        if (!text) {
          throw new KnowledgeDeliveryError("no_text", "Esta entrada no tiene texto; envía su archivo");
        }
        return sendText({
          conversationId: target.conversationId,
          organizationId: target.organizationId,
          text,
        });
      }
      if (!entry.filePath || !entry.fileMime) {
        throw new KnowledgeDeliveryError("no_file", "Esta entrada no tiene archivo");
      }
      const body = entry.body.trim();
      return sendMediaMessage({
        conversationId: target.conversationId,
        organizationId: target.organizationId,
        file: {
          data: await readKnowledgeFile(target.organizationId, entry),
          mimeType: entry.fileMime,
          fileName: entry.fileName ?? undefined,
        },
        caption: body && body.length <= CAPTION_MAX ? body : undefined,
      });
    }
    case "internal_chat": {
      const { session, threadId } = target;
      if (mode === "text") {
        const text = entry.body.trim();
        if (!text) {
          throw new KnowledgeDeliveryError("no_text", "Esta entrada no tiene texto; envía su archivo");
        }
        const { message } = await postMessage(session, threadId, {
          body: text.slice(0, TEAM_MESSAGE_MAX),
        });
        return { messageId: message.id };
      }
      if (!entry.filePath || !entry.fileMime) {
        throw new KnowledgeDeliveryError("no_file", "Esta entrada no tiene archivo");
      }
      const body = entry.body.trim();
      const { message } = await postMessage(session, threadId, {
        body: body && body.length <= CAPTION_MAX ? body : entry.title,
        file: {
          data: await readKnowledgeFile(session.organizationId, entry),
          mimeType: entry.fileMime,
          fileName: entry.fileName ?? entry.title,
        },
      });
      return { messageId: message.id };
    }
  }
}
