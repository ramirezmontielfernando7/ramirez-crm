import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { PersonalizationBack } from "@/components/settings/personalization-back";

/**
 * Ajustes → Apariencia (ronda 3). Apariencia y Notificaciones son renglones
 * propios del menú de Ajustes; «Más de la marca» (Marca) y Navegación son
 * páginas de detalle a las que se llega desde Apariencia y llevan un «volver».
 */
export default function PersonalizationLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div data-pm="subtabs-host" className="space-y-5">
      <PersonalizationBack>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-text-2">
          <Link href="/settings/personalization" className="inline-flex items-center gap-1 hover:text-foreground">
            <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
            Apariencia
          </Link>
          <Link href="/settings/personalization/marca" className="hover:text-foreground">Marca</Link>
          <Link href="/settings/personalization/navegacion" className="hover:text-foreground">Navegación</Link>
        </div>
      </PersonalizationBack>
      {children}
    </div>
  );
}
