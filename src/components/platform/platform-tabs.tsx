"use client";

import { SectionTabs } from "@/components/ui/section-tabs";

/** 036 (PR 4) — Las pestañas de Plataforma. Son rutas: el enlace se comparte y Atrás funciona. */
const TABS = [
  { href: "/platform", label: "Mi panel" },
  { href: "/platform/organizaciones", label: "Organizaciones" },
  { href: "/platform/costos", label: "Costos" },
] as const;

export function PlatformTabs() {
  return <SectionTabs tabs={TABS} label="Secciones de Plataforma" />;
}
