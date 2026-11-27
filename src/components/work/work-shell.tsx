"use client";

import { PageShell } from "@/components/ui/page-shell";

/**
 * 033 — Tareas y Notas (módulo `trabajo`). 2026-11: pestañas del renglón
 * «Agenda» junto a Citas (/bookings). Cada pantalla responde 404 sin su
 * módulo de todas formas.
 */
export type WorkSections = { citas: boolean; tareas: boolean; notas: boolean };

export function WorkShell({ children }: { sections?: WorkSections; children: React.ReactNode }) {
  // 2026-11 — Tareas, Citas y Notas son las pestañas del renglón «Agenda»
  // (las pinta `PageShell` desde el registro).
  return (
    <PageShell pillar="agenda" variant="fluid">
      <div className="min-h-0 flex-1">{children}</div>
    </PageShell>
  );
}
