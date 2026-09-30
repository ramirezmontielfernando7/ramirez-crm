import { readMediaFile } from "@/server/whatsapp/media";
import { getViewerBrandingContext } from "@/server/branding";
import { FAVICON_ASSET, generatedFaviconSvg } from "@/lib/favicon";
import { logger } from "@/lib/log";

const log = logger("branding");

export const dynamic = "force-dynamic";

/**
 * Cabeceras con las que se sirve CUALQUIER icono, subido o generado.
 *
 * Un SVG que sube el dueño es un documento con permiso de ejecutar guiones si
 * alguien navega a su URL. La CSP lo deja sin nada que ejecutar y `nosniff`
 * impide que el navegador reinterprete el tipo. Cuesta dos cabeceras y quita
 * de la mesa toda esa clase de problema.
 */
function cabeceras(mime: string, cacheable: boolean, deUnNegocio: boolean): HeadersInit {
  // H11: el icono de un negocio es de su sesión; un caché compartido (CDN,
  // proxy) no debe guardarlo para otros. El de la plataforma, sí.
  const alcance = deUnNegocio ? "private" : "public";
  return {
    "content-type": mime,
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    "x-content-type-options": "nosniff",
    // La URL lleva `?v=` y cambia con la marca, así que se puede cachear
    // fuerte. Sin ese sufijo —alguien pidiendo la ruta pelada— no.
    "cache-control": cacheable
      ? `${alcance}, max-age=31536000, immutable`
      : `${alcance}, max-age=60`,
  };
}

/**
 * El icono de la pestaña. **Ruta pública**: el login también tiene pestaña, y
 * ahí todavía no hay sesión. H11: con sesión es el icono de SU negocio; sin
 * sesión, el de la plataforma (nunca el de "la primera organización").
 */
export async function GET(req: Request) {
  const cacheable = new URL(req.url).searchParams.has("v");

  const ctx = await getViewerBrandingContext();
  const branding = ctx.branding;

  if (ctx.organizationId && branding.favicon) {
    try {
      const buf = await readMediaFile(ctx.organizationId, FAVICON_ASSET);
      return new Response(new Uint8Array(buf), {
        headers: cabeceras(branding.favicon.mime, cacheable, true),
      });
    } catch (err) {
      log.warn("el icono no está en MEDIA_DIR; se sirve el generado", {
        org: ctx.organizationId,
        codigo: (err as NodeJS.ErrnoException | null)?.code ?? "error",
      });
      // El archivo se perdió (volumen sin montar, restauración a medias). Se
      // cae al generado en vez de dejar la pestaña sin icono: un 404 aquí se
      // ve como si la instancia estuviera rota.
    }
  }

  return new Response(generatedFaviconSvg(branding), {
    headers: cabeceras("image/svg+xml", cacheable, ctx.organizationId !== null),
  });
}
