import { z } from "zod";
import { apiError, withAuth } from "@/lib/api";
import { TEAM_MESSAGE_MAX, TEAM_PAGE_MAX } from "@/lib/team-chat";
import { listMessages, postMessage, type TeamFileInput } from "@/server/team-chat/messages";
import { teamChatErrorResponse } from "@/server/team-chat/errors";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const pageSchema = z.object({
  before: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(TEAM_PAGE_MAX).optional(),
});

/**
 * 025 — Historial de un hilo, paginado hacia atrás (`?before=<id>&limit=`).
 * 404 si quien pregunta no participa (ni supervisa).
 */
export const GET = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const page = pageSchema.safeParse({
    before: url.searchParams.get("before") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!page.success) {
    return apiError(422, "invalid_query", `limit entre 1 y ${TEAM_PAGE_MAX}; before = id de mensaje`);
  }
  try {
    const { access, messages, hasMore } = await listMessages(session, id, page.data);
    return Response.json({
      messages,
      hasMore,
      relation: access.relation,
      canPost: access.canPost,
      canReact: access.canReact,
    });
  } catch (err) {
    return teamChatErrorResponse(err, "leer historial");
  }
});

const textSchema = z.object({ body: z.string().max(TEAM_MESSAGE_MAX * 2) });

/**
 * Publica en el hilo. JSON `{ body }` o multipart (`body` + `file`). El largo
 * se valida en el servidor (TEAM_MESSAGE_MAX); SVG y HTML se rechazan.
 */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  let body = "";
  let file: TeamFileInput | null = null;
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return apiError(422, "invalid_body", "Formulario inválido");
    }
    const rawBody = form.get("body");
    body = typeof rawBody === "string" ? rawBody : "";
    const f = form.get("file");
    if (f instanceof File && f.size > 0) {
      file = {
        data: Buffer.from(await f.arrayBuffer()),
        mimeType: f.type || "application/octet-stream",
        fileName: f.name || "archivo",
      };
    }
  } else {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return apiError(422, "invalid_body", "El body debe ser JSON válido");
    }
    const parsed = textSchema.safeParse(raw);
    if (!parsed.success) return apiError(422, "invalid_body", "Falta el texto del mensaje");
    body = parsed.data.body;
  }
  try {
    const { message } = await postMessage(session, id, { body, file });
    return Response.json({ message }, { status: 201 });
  } catch (err) {
    return teamChatErrorResponse(err, "publicar mensaje");
  }
});
