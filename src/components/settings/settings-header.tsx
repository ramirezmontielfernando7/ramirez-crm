import { cn } from "@/lib/utils";

/**
 * Pulido general (F, grupo 1): el MISMO encabezado en cada página de Ajustes.
 * Título de 22 px y una línea que dice para qué sirve; a la derecha, la acción
 * principal de la página si la hay. En el teléfono el título ya lo pinta la
 * barra de «← Sección» de `SettingsShell`, así que aquí se oculta.
 */
export function SettingsHeader({
  title,
  description,
  actions,
  className,
  mobileTitle = false,
}: {
  title: React.ReactNode;
  /** Sub-página (Marca, Navegación, Conexión directa): en el teléfono la barra
   *  dice la sección de arriba, así que aquí el título sí se muestra. */
  mobileTitle?: boolean;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)} data-testid="settings-header">
      <div className="min-w-[min(100%,16rem)] flex-1 space-y-1">
        <h2 className={cn("text-[22px] font-semibold tracking-tight", !mobileTitle && "max-lg:hidden")}>{title}</h2>
        {description && <p className="max-w-2xl text-[13.5px] leading-relaxed text-text-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
