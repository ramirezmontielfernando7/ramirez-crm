import { crmRecord, isRemoteId } from "./remote-crm-contract";

export const MEDIA_LIMIT = 100 * 1024 * 1024;
const mediaRead = /^\/api\/media\/[A-Za-z0-9_-]{1,64}$/;
const mediaSend =
  /^\/api\/conversations\/[A-Za-z0-9_-]{1,200}\/messages\/media$/;

export function allowsMediaRequest(
  method: string,
  path: string,
  writes: boolean,
) {
  return (
    (method === "GET" && mediaRead.test(path)) ||
    (writes && method === "POST" && mediaSend.test(path))
  );
}

export type MediaKind = "image" | "audio" | "video" | "document";
export type RemoteAttachment = {
  id: string;
  kind: MediaKind;
  mime: string;
  name: string;
  size: number | null;
};

const activeMime =
  /^(image\/svg\+xml|text\/html|application\/xhtml\+xml|text\/xml|application\/xml)$/i;
const unsafeExtension =
  /\.(svgz?|html?|xhtml|xml|mhtml?|apk|exe|msi|bat|cmd|sh|js|jar|com)$/i;
const typeShape = /^[\w.-]+\/[\w.+-]+$/;
const documentExtensions: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    ".pptx",
  "text/plain": ".txt",
  "text/csv": ".csv",
};

export function baseMime(raw: string) {
  return (raw.split(";")[0] ?? "").trim().toLowerCase();
}

export function safeDocument(mime: string) {
  return Object.hasOwn(documentExtensions, mime);
}

export function attachmentExtension(media: RemoteAttachment) {
  if (media.kind === "document")
    return documentExtensions[media.mime] ?? ".bin";
  const subtype = media.mime.split("/")[1] ?? "";
  if (!/^[a-z0-9]{1,10}$/.test(subtype)) return ".bin";
  if (subtype === "jpeg") return ".jpg";
  if (subtype === "mpeg" && media.kind === "audio") return ".mp3";
  return "." + subtype;
}

export function attachmentFromWire(raw: unknown): RemoteAttachment | undefined {
  if (!raw) return;
  const v = crmRecord(raw);
  if (!isRemoteId(v.assetId) || v.assetId.length > 64) return;
  const mime =
    typeof v.mimeType === "string"
      ? baseMime(v.mimeType)
      : "application/octet-stream";
  const name =
    typeof v.fileName === "string" ? v.fileName.slice(0, 180) : "Adjunto";
  const size =
    typeof v.fileSize === "number" &&
    Number.isSafeInteger(v.fileSize) &&
    v.fileSize >= 0
      ? v.fileSize
      : null;
  if (activeMime.test(mime) || unsafeExtension.test(name)) return;
  if (v.kind === "image" || v.kind === "sticker") {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) return;
    return { id: v.assetId, kind: "image", mime, name, size };
  }
  if (v.kind === "audio" || v.kind === "video") {
    if (!mime.startsWith(v.kind + "/") || !typeShape.test(mime)) return;
    return { id: v.assetId, kind: v.kind, mime, name, size };
  }
  if (v.kind === "document")
    return { id: v.assetId, kind: "document", mime, name, size };
}

export function uploadMediaKind(
  mime: string,
  name: string,
  size: number,
): MediaKind | null {
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MEDIA_LIMIT ||
    !typeShape.test(mime) ||
    activeMime.test(mime) ||
    unsafeExtension.test(name)
  )
    return null;
  if (/^image\/(jpeg|png|webp)$/.test(mime) && size <= 5 * 1024 * 1024)
    return "image";
  if (
    /^audio\/(aac|mp4|mpeg|amr|ogg|opus)/.test(mime) &&
    size <= 16 * 1024 * 1024
  )
    return "audio";
  if (/^video\/(mp4|3gpp)$/.test(mime) && size <= 16 * 1024 * 1024)
    return "video";
  return "document";
}

export function acceptsMediaResponse(media: RemoteAttachment, mime: string) {
  return media.kind === "document"
    ? mime === media.mime || mime === "application/octet-stream"
    : mime === media.mime;
}
