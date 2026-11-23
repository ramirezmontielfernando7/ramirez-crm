import { Directory, File, FileMode, Paths } from "expo-file-system";
import {
  attachmentExtension,
  baseMime,
  MEDIA_LIMIT,
  uploadMediaKind,
  type RemoteAttachment,
} from "../integration/remote-media";
import {
  RemoteHttpError,
  type RemoteAuthRepository,
} from "../integration/remote-http";

let generation = 0;
function storage() {
  return new Directory(Paths.cache, "dashfort-crm-media");
}

export function clearRemoteMedia() {
  generation++;
  const dirs = [
    storage(),
    new Directory(Paths.cache, "ImagePicker"),
    new Directory(Paths.cache, "DocumentPicker"),
  ];
  let failed = false;
  for (const dir of dirs) {
    try {
      if (dir.exists) dir.delete();
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error("No se pudo limpiar la caché privada.");
}

function newFile(extension: string) {
  const dir = storage();
  dir.create({ idempotent: true, intermediates: true });
  return new File(
    dir,
    `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`,
  );
}

export function deleteCacheFile(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    /* Session cleanup retries. */
  }
}

export async function cacheRemoteMedia(
  repo: RemoteAuthRepository,
  item: RemoteAttachment,
  signal: AbortSignal,
  thumbnail = false,
) {
  const session = generation;
  const file = newFile(attachmentExtension(item));
  try {
    file.create();
    const writer = file.open(FileMode.WriteOnly);
    try {
      await repo.downloadMedia(
        item,
        signal,
        async (chunk) => {
          if (generation !== session || signal.aborted)
            throw new RemoteHttpError(0);
          await writer.writeBytes(chunk);
        },
        thumbnail ? 5 * 1024 * 1024 : MEDIA_LIMIT,
      );
    } finally {
      writer.close();
    }
    if (generation !== session || signal.aborted) throw new RemoteHttpError(0);
    return file;
  } catch (error) {
    deleteCacheFile(file);
    throw error;
  }
}

export type LocalAttachment = ReturnType<typeof stageAttachment>;
export function stageAttachment(asset: {
  uri: string;
  mimeType?: string | null;
  name?: string | null;
  fileName?: string | null;
}) {
  const source = new File(asset.uri);
  const sourceName = asset.name ?? asset.fileName ?? source.name;
  const name = sourceName.replace(/[^\w. ()-]/g, "_").slice(-160) || "Adjunto";
  const mime = baseMime(asset.mimeType ?? source.type ?? "");
  const size = source.size;
  const kind = uploadMediaKind(mime, name, size);
  const ownedCopy = source.uri.startsWith(Paths.cache.uri);
  const file = kind
    ? newFile(attachmentExtension({ kind, mime, id: "", name, size }))
    : null;
  try {
    if (!file || !kind)
      throw new RemoteHttpError(size > MEDIA_LIMIT ? 413 : 415);
    if (ownedCopy) source.move(file);
    else source.copy(file);
    async function* chunks() {
      const reader = file!.readableStream().getReader();
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          yield next.value;
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
    return { file, uri: file.uri, name, size, mime, kind, chunks };
  } catch (reason) {
    if (file) deleteCacheFile(file);
    if (ownedCopy) deleteCacheFile(source);
    throw reason;
  }
}
