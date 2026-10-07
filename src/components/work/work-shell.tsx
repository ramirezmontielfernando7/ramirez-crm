"use client";

import { BriefcaseBusiness } from "lucide-react";
import { NavRevealButton } from "@/components/nav-mode";
import { SectionTabs, type SectionTab } from "@/components/ui/section-tabs";

/**
 * 033 — Cabecera de «Trabajo» con sus subpestañas: Citas (módulo `agenda`,
 * vive en /bookings), Tareas y Notas (las dos, módulo `trabajo`). Cada pestaña solo aparece
 * si su módulo está encendido para la organización; lo decide el servidor
 * (`workSections`) y cada pantalla responde 404 sin su módulo de todas formas.
 */
export type WorkSections = { citas: boolean; tareas: boolean; notas: boolean };

export function workTabs(s: WorkSections): SectionTab[] {
  const tabs: SectionTab[] = [];
  if (s.citas) tabs.push({ href: "/bookings", label: "Citas" });
  if (s.tareas) tabs.push({ href: "/trabajo/tareas", label: "Tareas" });
  if (s.notas) tabs.push({ href: "/trabajo/notas", label: "Notas" });
  return tabs;
}

export function WorkShell({ sections, children }: { sections: WorkSections; children: React.ReactNode }) {
  const tabs = workTabs(sections);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className={tabs.length > 1 ? "border-b px-4 pt-3 sm:px-6 sm:pt-4" : "border-b px-4 py-3 sm:px-6 sm:py-4"}>
        <div className="flex items-center gap-2">
          <NavRevealButton />
          <h2 className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
            <BriefcaseBusiness className="h-4 w-4 text-primary" /> Trabajo
          </h2>
        </div>
        {/* Con una sola pestaña no hay nada que elegir: solo el título. */}
        {tabs.length > 1 && <SectionTabs tabs={tabs} label="Secciones de Trabajo" />}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
