import { withAuth } from "@/lib/api";
import { isInlineImage } from "@/lib/team-chat";
import { readAttachment } from "@/server/team-chat/messages";
import { teamChatErrorResponse } from "@/server/team-chat/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 025 — Un adjunto del chat de equipo, solo para quien ve su hilo (404 si
 * no). Nunca se sirve como documento activo: `nosniff`, `sandbox` y, salvo
 * imágenes raster (jpeg/png/webp/gif), descarga con `attachment`.
 */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  try {
    const { row, data } = await readAttachment(session, id);
    const inline = isInlineImage(row.mimeType);
    const safeName = row.fileName.replace(/[^\w. ()-]/g, "_");
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": inline ? row.mimeType : "application/octet-stream",
        "content-length": String(data.byteLength),
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
        "cache-control": "private, max-age=86400",
      },
    });
  } catch (err) {
    return teamChatErrorResponse(err, "leer adjunto");
  }
});
