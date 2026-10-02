import { desc } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { isHeaderImageAvailable } from "@/lib/meta/upload";
import { countVariables, type TemplateDraft } from "@/lib/templates";
import {
  createTemplate,
  serializeTemplate,
  type HeaderImageInput,
  TemplateError,
  templateErrorStatus,
} from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const templates = await db
    .select()
    .from(schema.template)
    .where(scoped(schema.template.organizationId, session.organizationId))
    .orderBy(desc(schema.template.createdAt));
  return Response.json({
    templates: templates.map(serializeTemplate),
    // Campañas v2: sin META_APP_ID no se puede crear con imagen en el encabezado.
    headerImageAvailable: isHeaderImageAvailable(),
  });
});

const buttonSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("QUICK_REPLY"), text: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("URL"), text: z.string().trim().min(1).max(200), url: z.string().trim().min(1).max(2000) }),
]);

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  language: z.string().trim().min(2).max(10),
  category: z.enum(["UTILITY", "MARKETING"]),
  body: z.string().trim().min(1).max(4096),
  // Campañas v2: ejemplos, encabezado, pie y botones (opcionales: el
  // contrato anterior —solo cuerpo— sigue valiendo).
  // Sin `bodyExamples` (contrato anterior: integraciones y guiones que solo
  // mandan el cuerpo) se generan "ejemplo 1", "ejemplo 2"… como antes. La
  // pantalla de Ajustes siempre los manda escritos por la persona.
  bodyExamples: z.array(z.string().max(1000)).max(20).optional(),
  header: z
    .discriminatedUnion("format", [
      z.object({ format: z.literal("NONE") }),
      z.object({ format: z.literal("TEXT"), text: z.string().max(200) }),
      z.object({ format: z.literal("IMAGE") }),
    ])
    .default({ format: "NONE" }),
  footer: z.string().max(200).nullable().optional(),
  buttons: z.array(buttonSchema).max(20).default([]),
});

function legacyExamples(body: string): string[] {
  return Array.from({ length: countVariables(body) }, (_, i) => `ejemplo ${i + 1}`);
}

/** El tamaño máximo del cuerpo multipart (la imagen + el borrador). */
const MAX_MULTIPART_BYTES = 6 * 1024 * 1024;

/**
 * Crea la plantilla. JSON (sin imagen) o multipart: `draft` (el mismo JSON)
 * + `headerImage` (archivo) cuando el encabezado es de imagen.
 */
export const POST = withAuth(async (session, req: Request) => {
  let draft: TemplateDraft;
  let headerImage: HeaderImageInput | null = null;
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > MAX_MULTIPART_BYTES) return apiError(413, "too_large", "La imagen es demasiado grande (máximo 5 MB)");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return apiError(400, "invalid_body", "No se pudo leer el formulario");
    }
    const raw = form.get("draft");
    let json: unknown;
    try {
      json = typeof raw === "string" ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) return apiError(422, "invalid_body", "La plantilla no es válida");
    draft = { ...parsed.data, bodyExamples: parsed.data.bodyExamples ?? legacyExamples(parsed.data.body) };
    const file = form.get("headerImage");
    if (file instanceof File) {
      headerImage = {
        data: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type,
        fileName: file.name || "encabezado",
      };
    }
  } else {
    const body = await parseBody(req, createSchema);
    if (!body.ok) return body.response;
    // parseBody tipa la entrada (sin los defaults aplicados): se completan aquí.
    draft = {
      ...body.data,
      bodyExamples: body.data.bodyExamples ?? legacyExamples(body.data.body),
      header: body.data.header ?? { format: "NONE" },
      buttons: body.data.buttons ?? [],
    };
  }

  try {
    const template = await createTemplate(session.organizationId, draft, headerImage);
    return Response.json(
      { template: serializeTemplate(template) },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof TemplateError) {
      return apiError(templateErrorStatus(err), err.code, err.message);
    }
    throw err;
  }
}, { permission: "templates.manage" });
