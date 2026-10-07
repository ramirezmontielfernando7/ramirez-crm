"use client";

import { FlaskConical } from "lucide-react";
import { NavRevealButton } from "@/components/nav-mode";
import { SectionTabs, type SectionTab } from "@/components/ui/section-tabs";

/**
 * 031 (A2) — Encabezado del Laboratorio con sus subpestañas. Son rutas
 * (compartibles, Atrás funciona), igual que en Campañas.
 *
 * FASE B: aquí va la pestaña «Asignación por etapa» (ruta propia bajo el Laboratorio).
 * Todavía NO existe: no se agrega hasta que la fase B traiga su pantalla y su
 * tabla (0036), para no mostrar un enlace a la nada.
 */
const TABS: readonly SectionTab[] = [
  {
    href: "/lab",
    label: "Agentes",
    // El editor (/lab/agents/[id]) cuenta como parte de Agentes.
    match: (p) => p === "/lab" || p.startsWith("/lab/agents"),
  },
  { href: "/lab/evaluaciones", label: "Evaluaciones" },
  // (fase B) { href: <ruta de asignación>, label: "Asignación por etapa" }
];

export function LabShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b px-4 pt-3 sm:px-6 sm:pt-4">
        <div className="flex items-start gap-2">
          <NavRevealButton />
          <div>
            <h2 className="flex items-center gap-2 text-[17px] font-bold tracking-tight">
              <FlaskConical className="h-4 w-4 text-primary" /> Laboratorio
            </h2>
            <p className="text-xs text-muted-foreground">Sandbox interno — no envía mensajes reales</p>
          </div>
        </div>
        <SectionTabs tabs={TABS} label="Secciones del Laboratorio" />
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
