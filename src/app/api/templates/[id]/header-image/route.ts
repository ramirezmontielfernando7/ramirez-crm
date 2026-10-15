import { apiError, withAuth } from "@/lib/api";
import {
  attachTemplateHeaderImage,
  serializeTemplate,
  TemplateError,
  templateErrorStatus,
} from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** La imagen (máx. 5 MB) más el sobre del multipart. */
const MAX_MULTIPART_BYTES = 6 * 1024 * 1024;

/**
 * Adjunta la imagen del encabezado a una plantilla que ya existe (creada
 * fuera del CRM) para poder enviarla. Multipart con `image`. No llama a Meta.
 */
export const POST = withAuth(
  async (session, req: Request, ctx: Params) => {
    const { id } = await ctx.params;
    if (!(req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      return apiError(415, "invalid_body", "Envía la imagen como formulario");
    }
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > MAX_MULTIPART_BYTES) return apiError(413, "too_large", "La imagen es demasiado grande (máximo 5 MB)");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return apiError(400, "invalid_body", "No se pudo leer el formulario");
    }
    const file = form.get("image");
    if (!(file instanceof File)) return apiError(422, "invalid_body", "Sube la imagen del encabezado");
    try {
      const template = await attachTemplateHeaderImage(session.organizationId, id, {
        data: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type,
        fileName: file.name || "encabezado",
      });
      return Response.json({ template: serializeTemplate(template) });
    } catch (err) {
      if (err instanceof TemplateError) return apiError(templateErrorStatus(err), err.code, err.message);
      throw err;
    }
  },
  { permission: "templates.manage" }
);
