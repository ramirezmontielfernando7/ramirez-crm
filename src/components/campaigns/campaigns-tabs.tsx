"use client";

import Link from "next/link";
import { Settings2 } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";

/**
 * Campañas v2 — Cascarón de Campañas. 039: es el pilar «Marketing»
 * (`PageShell` con las pestañas del registro: Campañas, Audiencias,
 * Plantillas WhatsApp y Métricas y costos Meta) más el acceso a Ajustes de
 * envío. Las pestañas son rutas: el enlace se comparte y Atrás funciona.
 */
export function CampaignsShell({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <PageShell
      pillar="campaigns"
      variant="fluid"
      actions={
        <>
          {actions}
          <Link
            href="/campaigns/settings"
            aria-label="Ajustes de envío"
            title="Ajustes de envío"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Settings2 className="h-4 w-4" strokeWidth={1.8} />
          </Link>
        </>
      }
    >
      {children}
    </PageShell>
  );
}
