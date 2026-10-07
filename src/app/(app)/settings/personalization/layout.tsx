import { SectionTabs, type SectionTab } from "@/components/ui/section-tabs";

/**
 * Fase D — Ajustes → Personalización. Subpestañas (rutas, compartibles):
 * Apariencia (cada persona) · Marca y Navegación (solo quien administra; el
 * servidor valida igual en cada página y ruta).
 */
const TABS: readonly SectionTab[] = [
  { href: "/settings/personalization", label: "Apariencia" },
  { href: "/settings/personalization/marca", label: "Marca", permission: "settings.manage" },
  { href: "/settings/personalization/navegacion", label: "Navegación", permission: "settings.manage" },
];

export default function PersonalizationLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="space-y-5">
      <div className="border-b">
        <SectionTabs tabs={TABS} label="Secciones de Personalización" />
      </div>
      {children}
    </div>
  );
}
