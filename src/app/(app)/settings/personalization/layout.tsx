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
        {/* Pulido F: el mismo «‹ volver» que Conexión directa, sin migas sueltas. */}
        <Link href="/settings/personalization" className="inline-flex items-center gap-1 text-[13px] text-text-2 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          Apariencia
        </Link>
      </PersonalizationBack>
      {children}
    </div>
  );
}
