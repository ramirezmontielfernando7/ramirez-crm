import { cn } from "@/lib/utils";

/**
 * «Escribiendo…» de tres puntos. Listo para el día en que la Bandeja reciba
 * ese dato (hoy no lo tiene: solo se ve en la vista previa de Apariencia).
 * Sin movimiento si la persona pidió reducirlo (ver globals.css).
 */
export function TypingDots({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Escribiendo…"
      className={cn(
        "typing-dots inline-flex items-center gap-1 rounded-[14px] border border-bubble-in-border bg-bubble-in px-3 py-2.5",
        className,
      )}
    >
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </span>
  );
}
