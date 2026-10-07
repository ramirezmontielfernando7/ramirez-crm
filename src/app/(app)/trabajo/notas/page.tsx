import { requireModulePage } from "@/server/modules/page";
import { workSections } from "@/server/work/sections";
import { WorkShell } from "@/components/work/work-shell";
import { NotesClient } from "@/components/work/notes-client";

export const dynamic = "force-dynamic";

type Params = { nota?: string; nueva?: string; contacto?: string; conversacion?: string; nombre?: string };

/**
 * 033, PR 2 — Notas (tipo Keep). `?nota=<id>` abre esa nota (la de un chat,
 * si quien mira puede ver ese contacto: lo decide el servidor);
 * `?nueva=1&contacto=…&conversacion=…` abre una nueva ya ligada.
 */
export default async function NotasPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await requireModulePage("trabajo");
  const [sections, params] = await Promise.all([workSections(session.organizationId), searchParams]);
  return (
    <WorkShell sections={sections}>
      <NotesClient
        initialNoteId={params.nota ?? null}
        draftLink={
          params.nueva === "1" && params.contacto
            ? {
                contactId: params.contacto,
                conversationId: params.conversacion ?? null,
                name: params.nombre?.slice(0, 80) ?? "Contacto",
              }
            : null
        }
      />
    </WorkShell>
  );
}
