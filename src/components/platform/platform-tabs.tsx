"use client";

import { ShieldCheck } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";

/** 036 (PR 4) — Las pestañas de Plataforma. Son rutas: el enlace se comparte y Atrás funciona. */
const TABS = [
  { href: "/platform", label: "Mi panel" },
  { href: "/platform/organizaciones", label: "Organizaciones" },
  { href: "/platform/costos", label: "Costos" },
] as const;

/** 039 — Plataforma con el mismo cascarón (`PageShell`) que el resto de la app. */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  return (
    <PageShell title="Plataforma" icon={ShieldCheck} pillar={false} tabs={TABS} tabsLabel="Secciones de Plataforma">
      {children}
    </PageShell>
  );
}
