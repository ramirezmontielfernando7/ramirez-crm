import type { WorkSections } from "@/components/work/work-shell";
import { getOrgModules } from "@/server/modules";

/** 033 — Qué pestañas de «Trabajo» existen para esta organización. */
export async function workSections(organizationId: string): Promise<WorkSections> {
  const m = await getOrgModules(organizationId);
  return { citas: m.agenda, tareas: m.trabajo };
}
