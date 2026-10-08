import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { normalizeGroupName } from "@/lib/kb-docs";
import { kbDocsOff } from "@/server/kb-docs/flag";
import { kbGroupError, withKbDocErrors } from "@/server/kb-docs/http";
import { deleteGroup, renameGroup } from "@/server/kb-docs/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({ name: z.string() });

/** 037 — Renombrar. General no es un grupo con id: no se renombra. */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? kbDocsOff();
  if (off) return off;
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const name = normalizeGroupName(body.data.name);
  if (!name.ok) return kbGroupError(name.code);
  return withKbDocErrors(async () => {
    const group = await renameGroup(session.organizationId, id, name.name);
    return Response.json({ group: { id: group.id, name: group.name } });
  });
}, { permission: "agent.manage" });

/**
 * 037 — Eliminar el grupo. `?documents=move` (por defecto) deja sus
 * documentos en General; `?documents=delete` los borra (irreversible).
 */
export const DELETE = withAuth(async (session, req: Request, ctx: Params) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? kbDocsOff();
  if (off) return off;
  const { id } = await ctx.params;
  const mode = new URL(req.url).searchParams.get("documents") === "delete" ? "delete" : "move";
  return withKbDocErrors(async () => {
    const r = await deleteGroup(session.organizationId, id, mode);
    return Response.json({ deleted: true, documents: r.documents, mode });
  });
}, { permission: "agent.manage" });
