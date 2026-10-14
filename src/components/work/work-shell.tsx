"use client";

import { PageShell } from "@/components/ui/page-shell";
import { SectionTabs, type SectionTab } from "@/components/ui/section-tabs";

/**
 * 033 — Tareas y Notas (módulo `trabajo`). 039: viven en el pilar «CRM
 * Comercial» como la pestaña «Tareas y notas» (Citas es su propia pestaña,
 * «Agenda», en /bookings); aquí solo se elige entre Tareas y Notas. Cada
 * pantalla responde 404 sin su módulo de todas formas.
 */
export type WorkSections = { citas: boolean; tareas: boolean; notas: boolean };

export function workTabs(s: WorkSections): SectionTab[] {
  const tabs: SectionTab[] = [];
  if (s.tareas) tabs.push({ href: "/trabajo/tareas", label: "Tareas" });
  if (s.notas) tabs.push({ href: "/trabajo/notas", label: "Notas" });
  return tabs;
}

export function WorkShell({ sections, children }: { sections: WorkSections; children: React.ReactNode }) {
  const tabs = workTabs(sections);
  return (
    <PageShell pillar="pipeline" variant="fluid">
      {/* Con una sola pestaña no hay nada que elegir. */}
      {tabs.length > 1 && (
        <div className="shrink-0 px-4 pt-3 sm:px-6">
          <SectionTabs tabs={tabs} label="Secciones de Tareas y notas" variant="segmented" />
        </div>
      )}
      <div className="min-h-0 flex-1">{children}</div>
    </PageShell>
  );
}
