import { runWithOrganization } from "@/lib/request-context";
import { requireModulePage } from "@/server/modules/page";
import { listTaskPeople } from "@/server/work/tasks";
import { workSections } from "@/server/work/sections";
import { WorkShell } from "@/components/work/work-shell";
import { TasksClient } from "@/components/work/tasks-client";

export const dynamic = "force-dynamic";

type Params = { nueva?: string; contacto?: string; conversacion?: string; nombre?: string };

/**
 * 033 — Tareas. `?nueva=1&contacto=…&conversacion=…` abre el formulario ya
 * ligado (lo usa «Nueva tarea» desde el chat); la ligadura la valida el
 * servidor al guardar.
 */
export default async function TareasPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await requireModulePage("trabajo");
  const [sections, people, params] = await Promise.all([
    workSections(session.organizationId),
    runWithOrganization(session.organizationId, () => listTaskPeople(session.organizationId)),
    searchParams,
  ]);
  return (
    <WorkShell sections={sections}>
      <TasksClient
        people={people}
        me={session.userId}
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
