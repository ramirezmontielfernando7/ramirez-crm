import { z } from "zod";
import { TAG_COLORS } from "@/lib/tags";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { removeNumber, setNumberLabel } from "@/server/whatsapp/credentials";
import { listWhatsAppNumbers } from "@/server/credentials";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ phoneNumberId: string }> };

const patchSchema = z.object({
  /** El nombre que la empresa le da al número; vacío o null = sin nombre. */
  label: z.string().trim().max(40).nullable().optional(),
  /** Color de la etiqueta (paleta de la organización). */
  color: z.enum(TAG_COLORS).optional(),
});

/** 0080 — Cambia el nombre y/o el color de un número oficial («Ventas», «Sucursal Centro»). */
export const PATCH = withAuth(async (session, req: Request, ctx: Ctx) => {
  const { phoneNumberId } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const ok = await setNumberLabel(session.organizationId, phoneNumberId, {
    ...(body.data.label !== undefined ? { label: body.data.label } : {}),
    ...(body.data.color ? { color: body.data.color } : {}),
  });
  if (!ok) return apiError(404, "not_found", "Ese número no está conectado");
  return Response.json({ ok: true });
}, { permission: "settings.manage" });

/**
 * 0080 — Desconecta un número. Sus chats pasan al número principal. El
 * último número no se quita desde aquí: sin número no se puede contestar.
 */
export const DELETE = withAuth(async (session, _req: Request, ctx: Ctx) => {
  const { phoneNumberId } = await ctx.params;
  const all = await listWhatsAppNumbers(session.organizationId);
  if (!all.some((n) => n.phoneNumberId === phoneNumberId)) {
    return apiError(404, "not_found", "Ese número no está conectado");
  }
  if (all.length <= 1) {
    return apiError(409, "last_number", "Es tu único número: conecta otro antes de quitar este");
  }
  await removeNumber(session.organizationId, phoneNumberId);
  return Response.json({ ok: true });
}, { permission: "settings.manage" });
