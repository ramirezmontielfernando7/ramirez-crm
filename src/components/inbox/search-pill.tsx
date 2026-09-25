"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { Search, X } from "lucide-react";
import { MORPH } from "@/components/motion";
import { cn } from "@/lib/utils";

/** Todo el campo, visible: el destino del estirón. */
const FULL = "inset(0px 0px 0px 0px round 16px)";

/**
 * El buscador de la Bandeja como una lupa pequeña en la fila del título. Al
 * tocarla (o con "/"), la cápsula se ESTIRA hasta cubrir la fila y se vuelve
 * el campo; al cerrarlo se encoge de vuelta a la lupa.
 *
 * El estirón no anima `width` (recalcularía el layout en cada cuadro): el
 * campo ya mide la fila completa y lo que se anima es su recorte
 * (`clip-path`), que arranca exactamente sobre la lupa. El navegador lo
 * compone sin tocar el layout.
 *
 * Con texto escrito, perder el foco NO lo cierra: la lista filtrada nunca
 * queda escondida detrás de una lupa que no dice nada.
 */
export function SearchPill({
  query,
  onQuery,
  rowRef,
  onOpenChange,
  hint,
  className,
}: {
  query: string;
  onQuery: (q: string) => void;
  /** La fila del título: el campo abierto la cubre de lado a lado. */
  rowRef: React.RefObject<HTMLDivElement | null>;
  /** Para que la fila desvanezca lo que el campo va a cubrir. */
  onOpenChange?: (open: boolean) => void;
  /**
   * El filtro que sigue puesto ("No leídas +1"). El campo abierto tapa la
   * cápsula de filtros: sin esta marca, la búsqueda parecería ser sobre todo.
   */
  hint?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(FULL);
  // Dónde empieza el campo: en el título, no encima del ☰ (menú oculto), que
  // debe seguir a mano mientras se busca.
  const [left, setLeft] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const reduce = useReducedMotion();

  function show() {
    const rowEl = rowRef.current;
    const row = rowEl?.getBoundingClientRect();
    const b = trigger.current?.getBoundingClientRect();
    const start = rowEl?.querySelector("h2")?.offsetLeft ?? 0;
    setLeft(start);
    if (row && b) {
      // El campo mide 32 px de alto centrado en la fila; la lupa, 24. El
      // recorte inicial es EXACTAMENTE la lupa: de ahí se estira.
      const dy = 4;
      setFrom(
        `inset(${dy}px ${Math.max(0, row.right - b.right)}px ${dy}px ${Math.max(0, b.left - row.left - start)}px round 16px)`
      );
    }
    setOpen(true);
    onOpenChange?.(true);
  }

  function close() {
    setOpen(false);
    onOpenChange?.(false);
  }

  function hide() {
    onQuery("");
    close();
    trigger.current?.focus();
  }

  // "/" abre el buscador desde cualquier parte de la Bandeja, salvo cuando
  // ya se está escribiendo en algo (el compositor, una nota…).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      if (open) input.current?.focus();
      else show();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={show}
        aria-label="Buscar conversación (/)"
        title="Buscar ( / )"
        aria-expanded={open}
        className={cn(
          // Abierto, la lupa se desvanece: el campo que sale de ella la cubre.
          open && "pointer-events-none opacity-0",
          "box-border flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong bg-chip text-text-2 transition-[border-color,transform,opacity] duration-150 hover:border-text-3 active:scale-90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          className
        )}
      >
        <Search className="h-3.5 w-3.5" strokeWidth={1.9} />
      </button>

      <AnimatePresence>
        {open && (
          <m.div
            key="campo"
            initial={{ clipPath: from }}
            animate={{ clipPath: FULL }}
            exit={{ clipPath: from, transition: reduce ? { duration: 0 } : { ...MORPH, duration: 0.2 } }}
            transition={reduce ? { duration: 0 } : MORPH}
            onAnimationStart={() => input.current?.focus()}
            style={{ left }}
            // Del título al borde derecho de la fila, 32 px centrados. Fondo
            // SÓLIDO: a medio estirón no se transparenta lo de abajo.
            className="absolute right-0 top-1/2 z-20 -mt-4 flex h-8 items-center gap-2 rounded-full border border-brand bg-card px-3 shadow-sm ring-[3px] ring-brand-soft"
          >
            {/* Mientras la cápsula se estira, su contenido espera: a medio
                camino se ve una forma que crece, no texto recortado. */}
            <m.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: reduce ? { duration: 0 } : { duration: 0.14, delay: 0.1 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              className="flex min-w-0 flex-1 items-center gap-2"
            >
              <Search className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.7} />
              <input
                ref={input}
                autoFocus
                value={query}
                placeholder="Buscar por nombre o teléfono…"
                aria-label="Buscar conversación"
                onChange={(e) => onQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    hide();
                  }
                }}
                onBlur={() => {
                  if (!query) close();
                }}
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-text-3"
              />
              {hint && (
                <span className="shrink-0 whitespace-nowrap rounded-full bg-brand-tint px-1.5 py-[2px] text-[10.5px] font-semibold leading-none text-brand-text">
                  {hint}
                </span>
              )}
              <button
                type="button"
                // mousedown: que el blur del campo no lo cierre antes del clic.
                onMouseDown={(e) => e.preventDefault()}
                onClick={hide}
                aria-label={query ? "Limpiar búsqueda" : "Cerrar búsqueda"}
                className="shrink-0 rounded-full p-0.5 text-text-3 transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}
