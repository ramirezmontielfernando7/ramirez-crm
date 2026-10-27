import { apiError, withAuth } from "@/lib/api";
import { CHAT_MEDIA_MAX_BYTES } from "@/lib/upload-limits";
import { answer } from "@/server/mi-numero/http";
import { miNumeroOff } from "@/server/mi-numero/numbers";
import { sendFromMyNumber } from "@/server/mi-numero/send";
import { numberSendError } from "@/server/mi-numero/send-http";
import { readUploadForm, withUploadSlot } from "@/server/uploads/body";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Mi número (046), PR 5 — Mandar un archivo en uno de MIS chats por mi número (multipart: `file` + `caption`). */
export const POST = withAuth(async (session, req: Request, { params }: Params) => {
  const off = await miNumeroOff(session.organizationId);
  if (off) return off;
  const { id } = await params;
  return withUploadSlot(req, async () => {
    const read = await readUploadForm(req, CHAT_MEDIA_MAX_BYTES, () =>
      apiError(413, "too_large", "El archivo pasa de 100 MB, lo más que acepta WhatsApp.")
    );
    if (!read.ok) return read.response;
    const file = read.form.get("file");
    if (!(file instanceof File)) return apiError(422, "invalid", "Falta el archivo (campo `file`)");
    const captionRaw = read.form.get("caption");
    const caption = typeof captionRaw === "string" && captionRaw.trim() ? captionRaw.trim().slice(0, 1024) : undefined;
    const data = Buffer.from(await file.arrayBuffer());
    return answer(async () => {
      try {
        const r = await sendFromMyNumber(session.organizationId, session.userId, id, {
          file: { data, mimeType: file.type || "application/octet-stream", fileName: file.name || undefined },
          caption,
        });
        return Response.json({ messageId: r.messageId, ...(r.queuedUntil ? { queuedUntil: r.queuedUntil.toISOString() } : {}) }, { status: 201 });
      } catch (err) {
        return numberSendError(err);
      }
    });
  });
});
