import data from "emojibase-data/es/data.json";

/**
 * Datos del selector de emojis del compositor (frimousse), servidos por la
 * propia instancia en vez de jsDelivr: el núcleo no depende de un CDN
 * (constitución II). Se congela al construir; la versión la fija el lockfile.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(data);
}
