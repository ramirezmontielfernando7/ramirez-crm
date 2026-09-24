import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scopedMediaAssets } from "@/lib/db/tenant";
import {
  ensureAssetAvailable,
  readMediaFile,
} from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ assetId: string }> };

/**
 * 008 — Sirve el binario de un adjunto desde el volumen local. Solo con
 * sesión y dentro de la organización (un asset ajeno responde 404: jamás se
 * filtra existencia entre tenants). Si el archivo aún no se descargó,
 * intenta on-demand contra Graph; si Meta ya lo expiró → 410.
 */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { assetId } = await ctx.params;
  if (!/^[\w.-]{1,64}$/.test(assetId)) {
    return apiError(422, "invalid", "assetId inválido");
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.mediaAsset)
    .where(
      scopedMediaAssets(
        schema.mediaAsset.organizationId,
        session.access,
        schema.mediaAsset.id,
        eq(schema.mediaAsset.id, assetId)
      )
    )
    .limit(1);
  let asset = rows[0];
  if (!asset) return apiError(404, "not_found", "Adjunto no encontrado");

  if (asset.kind === "location" || asset.kind === "contacts") {
    // Sin binario: el payload viaja en el DTO del mensaje.
    return apiError(404, "no_binary", "Este adjunto no tiene archivo");
  }

  if (asset.fetchStatus !== "available") {
    // On-demand: reintenta la descarga en el momento (pending o failed).
    asset = (await ensureAssetAvailable(session.organizationId, assetId)) ?? asset;
  }
  if (asset.fetchStatus !== "available" || !asset.storagePath) {
    return apiError(
      410,
      "gone",
      "El contenido ya no está disponible (expiró en WhatsApp antes de poder copiarse)"
    );
  }

  try {
    const data = await readMediaFile(session.organizationId, assetId);
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": asset.mimeType ?? "application/octet-stream",
        "content-length": String(data.byteLength),
        // El contenido de un asset es inmutable; privado por sesión.
        "cache-control": "private, max-age=86400",
        ...(asset.fileName
          ? {
              "content-disposition": `inline; filename="${asset.fileName.replace(/[^\w. -]/g, "_")}"`,
            }
          : {}),
      },
    });
  } catch {
    return apiError(410, "gone", "El archivo del adjunto no está en el volumen");
  }
});
