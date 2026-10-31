import type { KnowledgeRow } from "@/server/knowledge/store";
import { readKnowledgeFile } from "@/server/knowledge/store";
import { KnowledgeDeliveryError, type KnowledgeSendMode } from "@/server/knowledge/deliver";
import { sendFromMyNumber } from "@/server/mi-numero/send";

/** Pie del archivo: el texto de la entrada si cabe en un pie de WhatsApp. */
const CAPTION_MAX = 1024;

/**
 * Una entrada de Conocimientos por MI número: texto, o el archivo con el texto
 * como pie. Vive aquí (no en `knowledge/`) porque la vía directa es solo de
 * «Mi número» (guardarraíl `conexion-directa-envio.test.ts`).
 */
export async function deliverKnowledgeToMyNumber(
  input: {
    organizationId: string;
    userId: string;
    conversationId: string;
    via?: { aiConnectionId: string; aiSenderName: string | null };
  },
  entry: KnowledgeRow,
  mode: KnowledgeSendMode
): Promise<{ messageId: string }> {
  const body = entry.body.trim();
  if (mode === "text") {
    if (!body) throw new KnowledgeDeliveryError("no_text", "Esta entrada no tiene texto; envía su archivo");
    const r = await sendFromMyNumber(input.organizationId, input.userId, input.conversationId, { text: body }, input.via);
    return { messageId: r.messageId };
  }
  if (!entry.filePath || !entry.fileMime) throw new KnowledgeDeliveryError("no_file", "Esta entrada no tiene archivo");
  const r = await sendFromMyNumber(
    input.organizationId,
    input.userId,
    input.conversationId,
    {
      file: { data: await readKnowledgeFile(input.organizationId, entry), mimeType: entry.fileMime, fileName: entry.fileName ?? undefined },
      caption: body && body.length <= CAPTION_MAX ? body : undefined,
    },
    input.via
  );
  return { messageId: r.messageId };
}
