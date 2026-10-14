"use client";

import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { SectionTabs, type SectionTab } from "@/components/ui/section-tabs";
import { pathWithin } from "@/lib/modules/nav-layout";

/**
 * 039 — Ajustes en 5 pestañas (`SectionTabs` del `PageShell`), cada una con
 * sus páginas de siempre (sus direcciones no cambian):
 *
 * 1. Canales y Meta: WhatsApp, Messenger, Plantillas (sin Campañas) y
 *    Anuncios (Atribución / CAPI).
 * 2. Equipo y permisos: Miembros y roles, Chat de equipo.
 * 3. Operación CRM: Etiquetas y Conectores de agenda.
 * 4. Marca y apariencia: Personalización (Apariencia, Marca y Navegación).
 * 5. Uso y plan: el consumo del mes contra los topes (solo el Propietario).
 *
 * Una pestaña aparece si al menos una de sus páginas se puede abrir; con más
 * de una, sus páginas van en una segunda fila dentro del contenido. Qué
 * páginas existen lo decide el servidor y baja por prop (`allowed` y los
 * módulos): este es un componente de cliente y no puede leer variables de
 * entorno. El servidor valida igual cada página y cada ruta.
 */
type Page = { slug: string; label: string };
type Group = { label: string; pages: readonly Page[] };

const GROUPS: readonly Group[] = [
  {
    label: "Canales y Meta",
    pages: [
      { slug: "whatsapp", label: "WhatsApp" },
      { slug: "messenger", label: "Messenger" },
      { slug: "templates", label: "Plantillas" },
      { slug: "ads", label: "Anuncios (CAPI)" },
    ],
  },
  {
    label: "Equipo y permisos",
    pages: [
      { slug: "team", label: "Miembros y roles" },
      { slug: "team-chat", label: "Chat de equipo" },
    ],
  },
  {
    label: "Operación CRM",
    pages: [
      { slug: "tags", label: "Etiquetas" },
      { slug: "calendar", label: "Conectores de agenda" },
    ],
  },
  // Fase D: Marca y Navegación son subpestañas de Personalización.
  { label: "Marca y apariencia", pages: [{ slug: "personalization", label: "Personalización" }] },
  // 036 (PR 6) → 039: «Uso y plan» vive aquí (antes /uso, que redirige).
  { label: "Uso y plan", pages: [{ slug: "uso", label: "Uso y plan" }] },
];

const href = (slug: string) => `/settings/${slug}`;

/** Las 5 pestañas, solo con las páginas que existen para quien mira. */
export function settingsGroups(visible: (slug: string) => boolean): { label: string; pages: Page[] }[] {
  return GROUPS.map((g) => ({ label: g.label, pages: g.pages.filter((p) => visible(p.slug)) })).filter(
    (g) => g.pages.length > 0
  );
}

export function SettingsShell({
  agenda = false,
  atribucion = false,
  messenger = false,
  templates = true,
  allowed,
  children,
}: {
  agenda?: boolean;
  atribucion?: boolean;
  messenger?: boolean;
  /** 030 (PR 4) — con Campañas encendido, Plantillas vive en Marketing. */
  templates?: boolean;
  /** 020 — páginas que el rol puede abrir (`/settings/<clave>`); lo decide el servidor. */
  allowed?: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const groups = settingsGroups((slug) => {
    // 015/016/017 — Agenda, Anuncios y Messenger solo con su módulo.
    if (slug === "calendar" && !agenda) return false;
    if (slug === "ads" && !atribucion) return false;
    if (slug === "messenger" && !messenger) return false;
    if (slug === "templates" && !templates) return false;
    return !allowed || allowed.includes(slug);
  });
  const tabs: SectionTab[] = groups.map((g) => ({
    href: href(g.pages[0]!.slug),
    label: g.label,
    // Exacta o subruta: "/settings/team" no debe encender "/settings/team-chat".
    match: (p) => g.pages.some((page) => pathWithin(href(page.slug), p)),
  }));
  const current = groups.find((g) => g.pages.some((page) => pathWithin(href(page.slug), pathname)));
  return (
    <PageShell title="Ajustes" icon={Settings} pillar={false} tabs={tabs} tabsLabel="Secciones de Ajustes">
      {current && current.pages.length > 1 && (
        // 039: sub-secciones como control segmentado dentro del contenido (nunca
        // una segunda barra bajo el encabezado de 56 px).
        <div className="mb-5">
          <SectionTabs
            variant="segmented"
            tabs={current.pages.map((page) => ({
              href: href(page.slug),
              label: page.label,
              match: (p) => pathWithin(href(page.slug), p),
            }))}
            label={`Secciones de ${current.label}`}
          />
        </div>
      )}
      {children}
    </PageShell>
  );
}
