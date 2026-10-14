"use client";

import { PageShell } from "@/components/ui/page-shell";

/**
 * 031 (A2) — Encabezado del Laboratorio con sus subpestañas. 039: es el pilar
 * «Estudio de IA» (`PageShell` con las pestañas del registro: Mis agentes,
 * Conocimiento y documentos, Asignación por etapa y Evaluaciones). Son rutas
 * (compartibles, Atrás funciona).
 *
 * 035 — «Conocimiento y documentos» solo existe con KB_DOCS (lo decide el
 * layout en el servidor); 037: cada grupo (/lab/documentos/[grupo]) cuenta
 * como parte de esa pestaña.
 */
const SIN_DOCUMENTOS = ["/lab/documentos"] as const;

export function LabShell({ children, documents = false }: { children: React.ReactNode; documents?: boolean }) {
  return (
    <PageShell
      pillar="lab"
      variant="fluid"
      subtitle="Sandbox interno — no envía mensajes reales"
      hideSections={documents ? undefined : SIN_DOCUMENTOS}
    >
      <div className="min-h-0 flex-1">{children}</div>
    </PageShell>
  );
}
