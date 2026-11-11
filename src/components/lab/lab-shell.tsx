"use client";

import { createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { AgentPauseBar } from "@/components/lab/agent-pause-bar";
import { PageShell } from "@/components/ui/page-shell";

/**
 * 031 (A2) — Encabezado del Laboratorio con sus subpestañas. 039: es el pilar
 * «Agentes IA» (antes «Estudio de IA»; `PageShell` con las pestañas del
 * registro: Mis agentes, Asignación por etapa y Pruebas). Son rutas (compartibles,
 * Atrás funciona).
 *
 * 035 — «Conocimiento» solo existe con KB_DOCS (lo decide el layout en el
 * servidor); 037: cada grupo (/lab/documentos/[grupo]) cuenta como parte de
 * esa pestaña.
 *
 * Ronda 3: cada pestaña pone sus botones a la derecha del encabezado con
 * `<LabActions>` (portal al hueco de acciones). El editor de un agente
 * (/lab/agents/[id]) tiene su PROPIO encabezado (volver, nombre, Creador ·
 * Formulario · Versiones, Publicar), así que aquí no se pinta ninguno.
 * La barra «Agentes de IA: activos» ya no existe: la pausa general es el botón
 * «Pausar toda la IA» de «Mis agentes»; en pausa, el aviso rojo sigue arriba.
 */
const SIN_DOCUMENTOS = ["/lab/documentos"] as const;

const ActionsSlot = createContext<HTMLElement | null>(null);

/** Botones de la pestaña, a la derecha del encabezado del Estudio de IA. */
export function LabActions({ children }: { children: React.ReactNode }) {
  const slot = useContext(ActionsSlot);
  return slot ? createPortal(children, slot) : null;
}

export function LabShell({ children, documents = false }: { children: React.ReactNode; documents?: boolean }) {
  const pathname = usePathname();
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  if (pathname.startsWith("/lab/agents/")) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-premium-area="lab">
        {children}
      </div>
    );
  }

  // 2026-11 — Los Documentos (/lab/documentos) son la pestaña «Para que lea la
  // IA» de la Biblioteca: siguen en esta dirección, con el encabezado de ella.
  const library = pathname.startsWith("/lab/documentos");

  return (
    <PageShell
      pillar={library ? "knowledge" : "lab"}
      variant="fluid"
      subtitle="Modo prueba: aquí nada se envía a tus clientes"
      hideSections={documents ? undefined : SIN_DOCUMENTOS}
      actions={<span ref={setSlot} className="flex items-center gap-2" data-lab-actions />}
    >
      <ActionsSlot.Provider value={slot}>
        {/* En «Mis agentes» la pausa la dice el interruptor de la IA (paquete B). */}
        {pathname !== "/lab" && !library && <AgentPauseBar />}
        <div className="min-h-0 flex-1" data-premium-area="lab">
          {children}
        </div>
      </ActionsSlot.Provider>
    </PageShell>
  );
}
