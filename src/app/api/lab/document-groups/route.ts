import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { MAX_DOC_GROUPS, normalizeGroupName } from "@/lib/kb-docs";
import { kbDocsOff } from "@/server/kb-docs/flag";
import { kbGroupError, withKbDocErrors } from "@/server/kb-docs/http";
import { createGroup, listGroups } from "@/server/kb-docs/store";
import { moduleOff } from "@/server/modules";

export const dynamic = "force-dynamic";

/** 037 — Los grupos de documentos (General primero), con cuántos documentos tiene cada uno. */
export const GET = withAuth(async (session) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? kbDocsOff();
  if (off) return off;
  return Response.json({ groups: await listGroups(session.organizationId), maxGroups: MAX_DOC_GROUPS });
}, { permission: "agent.manage" });

const postSchema = z.object({ name: z.string() });

/** 037 — Crea un grupo. 422 nombre inválido o «General» · 409 repetido o tope. */
export const POST = withAuth(async (session, req: Request) => {
  const off = (await moduleOff(session.organizationId, "lab")) ?? kbDocsOff();
  if (off) return off;
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;
  const name = normalizeGroupName(body.data.name);
  if (!name.ok) return kbGroupError(name.code);
  return withKbDocErrors(async () => {
    const group = await createGroup(session.organizationId, name.name);
    return Response.json({ group: { id: group.id, name: group.name, documents: 0 } }, { status: 201 });
  });
}, { permission: "agent.manage" });
