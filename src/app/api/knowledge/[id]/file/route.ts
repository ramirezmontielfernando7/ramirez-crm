import { apiError, withAuth } from "@/lib/api";
import { getKnowledge, readKnowledgeFile } from "@/server/knowledge/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Tipos que el navegador puede abrir sin riesgo; lo demás se descarga. */
const INLINE = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/;

/**
 * 024 — El archivo de una entrada, con sesión y dentro de la organización.
 * Un archivo subido nunca se sirve como HTML: `nosniff`, `sandbox` y, salvo
 * imágenes y PDF, `attachment`.
 */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const row = await getKnowledge(session.organizationId, id);
  if (!row?.filePath || !row.fileMime) {
    return apiError(404, "not_found", "Esta entrada no tiene archivo");
  }
  try {
    const data = await readKnowledgeFile(session.organizationId, row);
    const safeName = (row.fileName ?? "archivo").replace(/[^\w. -]/g, "_");
    const inline = INLINE.test(row.fileMime);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": inline ? row.fileMime : "application/octet-stream",
        "content-length": String(data.byteLength),
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
        "cache-control": "private, max-age=86400",
      },
    });
  } catch {
    return apiError(410, "gone", "El archivo no está en el volumen");
  }
});
