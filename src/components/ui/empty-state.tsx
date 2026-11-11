import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pulido general (F, grupo 2): el MISMO aspecto para «todavía no hay nada» en
 * todas las pantallas. Ícono en un círculo suave de la marca, título corto,
 * una línea que dice qué hacer y, si aplica, la acción para empezar. `compact`
 * es para dentro de una tarjeta o tabla; sin él, para el centro de la página.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className,
  testId,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={cn("mx-auto flex max-w-sm flex-col items-center text-center", compact ? "py-8" : "py-14", className)}
      data-testid={testId ?? "empty-state"}
    >
      {Icon && (
        <span
          className={cn(
            "mb-3 flex items-center justify-center rounded-full bg-brand-tint text-brand-text",
            compact ? "h-9 w-9" : "h-11 w-11"
          )}
          aria-hidden
        >
          <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} strokeWidth={1.8} />
        </span>
      )}
      <p className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-[15px]")}>{title}</p>
      {description && <p className="mt-1 text-[13px] leading-relaxed text-text-2">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
