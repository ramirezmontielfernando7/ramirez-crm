"use client";

import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";

/**
 * 036 (PR 4) / 040 — Las pestañas de Plataforma (rutas: el enlace se comparte
 * y Atrás funciona). «Organizaciones y Planes» sigue activa en la ficha de
 * cada organización, que dibuja su propio `PageShell` (volver + sus pestañas).
 */
export const PLATFORM_TABS = [
  { href: "/platform/panel", label: "Mi panel" },
  { href: "/platform/organizaciones", label: "Organizaciones y Planes" },
  { href: "/platform/costos", label: "Costos y Precios IA" },
  { href: "/platform/webhooks", label: "Webhooks sin ruta" },
  { href: "/platform/conexion-directa", label: "Conexión directa" },
  { href: "/platform/admin", label: "Administradores y auditoría" },
] as const;

/** ¿Es la ficha de una organización? (`/platform/organizaciones/<id>[/…]`). */
export function isOrganizationDetail(pathname: string): boolean {
  return /^\/platform\/organizaciones\/[^/]+/.test(pathname);
}

/** 039 — Plataforma con el mismo cascarón (`PageShell`) que el resto de la app. */
export function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isOrganizationDetail(pathname)) return <>{children}</>;
  return (
    <PageShell title="Plataforma" icon={ShieldCheck} pillar={false} tabs={PLATFORM_TABS} tabsLabel="Secciones de Plataforma">
      {children}
    </PageShell>
  );
}
