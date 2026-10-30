import { notFound, redirect } from "next/navigation";
import { UploadLinkClient, type UploadLinkView } from "@/components/ai-connector/upload-link-client";
import { UPLOAD_LINK_MAX_FILES, UPLOAD_LINK_STATE_TEXT } from "@/lib/ai-connector";
import { can } from "@/lib/auth/permissions";
import { getSessionOrNull } from "@/lib/auth/session";
import { GENERAL_GROUP_NAME } from "@/lib/kb-docs";
import { runWithOrganization } from "@/lib/request-context";
import { findUploadLink, stateOf } from "@/server/ai-connector/upload-links";
import { listGroups } from "@/server/kb-docs/store";
import { getKnowledge } from "@/server/knowledge/store";
import { orgHasConectorIa, orgHasModule } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * 047 — Enlace de subida que pidió la IA conectada. Solo lo abre quien lo
 * pidió, con su sesión; la subida va por `/api/ai-connector/upload-links/…`.
 */
export default async function UploadLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await getSessionOrNull();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/subir/${token}`)}`);
  const org = session.organizationId;
  if (!(await orgHasConectorIa(org)) || !(await orgHasModule(org, "knowledge"))) notFound();

  const view = await runWithOrganization(org, async (): Promise<UploadLinkView> => {
    if (!can(session, "knowledge.manage")) return { kind: "message", text: "Tu rol no puede subir archivos a la Biblioteca." };
    const link = await findUploadLink(org, session.userId, token);
    if (!link) return { kind: "message", text: "Este enlace no existe o lo pidió otra persona. Pídele a tu IA uno nuevo." };
    const state = stateOf(link);
    const [groups, rows] = await Promise.all([
      link.rag ? listGroups(org) : Promise.resolve([]),
      Promise.all(link.entryIds.map((id) => getKnowledge(org, id))),
    ]);
    return {
      kind: "link",
      token,
      note: link.note,
      tags: link.tags,
      inChat: link.inChat,
      rag: link.rag,
      groupName: link.rag ? (groups.find((g) => g.id === link.ragGroupId)?.name ?? GENERAL_GROUP_NAME) : null,
      expiresAt: link.expiresAt.toISOString(),
      maxFiles: UPLOAD_LINK_MAX_FILES,
      closedText: state === "open" ? null : UPLOAD_LINK_STATE_TEXT[state],
      uploaded: rows.flatMap((r) => (r ? [{ id: r.id, title: r.title, fileName: r.fileName }] : [])),
    };
  });
  return <UploadLinkClient view={view} />;
}
