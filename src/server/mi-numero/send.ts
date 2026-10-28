import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isPaused } from "@/lib/direct-send";
import { numberMediaId } from "@/lib/direct-inbound";
import { getDirectConnection } from "@/server/credentials/direct-instance";
import { sendDirect, type DirectResult } from "@/server/direct-connection/send";
import { saveMediaFile, validateOutgoing } from "@/server/whatsapp/media";
import { notifyNumberChat, pauseAiOnHumanReply } from "./ai";
import { numberAudience } from "./audience";
import { myChat } from "./chats";
import { MiNumeroFailure } from "./numbers";

/**
 * Mi número (046), PR 5 — La persona contesta uno de SUS chats desde
 * Dashfort: sale por el dispositivo de su número (nunca por Meta ni por el de
 * la empresa), con sus propios límites, fila y freno
 * (`src/server/direct-connection/send.ts`). Solo su dueño (la sesión decide;
 * nunca un id del navegador). La IA, las campañas y el cerebro externo nunca
 * llegan aquí (guardarraíl `tests/unit/conexion-directa-envio.test.ts`).
 * 047: la IA conectada del DUEÑO sí, en sus chats de cliente con el quinto
 * interruptor encendido (`src/server/ai-connector/my-number.ts`): actúa
 * como él.
 *
 * Errores: `MiNumeroFailure` (sin número, no conectado, en pausa),
 * `MediaValidationError` (archivo) y `DirectSendFailure` (el envío).
 */
export type NumberOutgoing =
  | { text: string }
  | { file: { data: Buffer; mimeType: string; fileName?: string }; caption?: string };

export async function sendFromMyNumber(
  organizationId: string,
  userId: string,
  conversationId: string,
  input: NumberOutgoing,
  /** 047: lo manda la IA conectada del dueño (solo texto, solo chats de cliente: lo revisa quien llama). */
  via?: { aiConnectionId: string; aiSenderName: string | null }
): Promise<DirectResult> {
  const { number, conversation } = await myChat(organizationId, userId, conversationId);
  const connection = await getDirectConnection(organizationId, number.id);
  if (!connection || connection.status !== "connected") throw new MiNumeroFailure("not_linked");
  if (isPaused(connection, new Date())) throw new MiNumeroFailure("paused");
  const scope = { directNumberId: number.id, audience: await numberAudience(organizationId, number) };
  // PR 8: la persona contesta → la IA se hace a un lado en este chat (la reanuda ella).
  if (await pauseAiOnHumanReply(organizationId, conversation.id)) await notifyNumberChat(organizationId, conversation.id);

  if ("text" in input) {
    return sendDirect({ organizationId, conversationId: conversation.id, type: "text", text: input.text, number: scope, ...via });
  }

  // El archivo queda en disco antes de salir (también si espera en la fila).
  const kind = validateOutgoing(input.file.mimeType, input.file.data.byteLength, input.file.fileName);
  const assetId = newId("mediaAsset");
  const storagePath = await saveMediaFile(organizationId, assetId, input.file.data);
  const [asset] = await getDb()
    .insert(schema.mediaAsset)
    .values({
      id: assetId,
      organizationId,
      kind,
      // Marca de «Mi número»: los filtros de siempre (`scopedMediaAssets`) no lo sirven a nadie más.
      waMediaId: numberMediaId(number.id, `out-${assetId}`),
      mimeType: input.file.mimeType,
      fileName: input.file.fileName ?? null,
      fileSize: input.file.data.byteLength,
      caption: input.caption ?? null,
      storagePath,
      fetchStatus: "available",
    })
    .returning();
  return sendDirect({ organizationId, conversationId: conversation.id, type: kind, text: null, mediaAsset: asset!, number: scope });
}
