"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import { SPRING } from "@/components/motion";
import { cn } from "@/lib/utils";

export type InboxFilter = "all" | "unread" | "anuncios" | "humano";

/**
 * Los filtros de la Bandeja en UNA cápsula junto al título: dice qué se está
 * viendo ("Todas 26", "No leídas 4") y al tocarla despliega el resto —
 * qué mostrar, la etapa y quién atiende —. Antes era una fila entera de
 * cápsulas y selectores que envolvía a dos líneas en una columna de 360 px.
 *
 * En reposo la cápsula es neutra; con CUALQUIER filtro puesto se pinta del
 * acento, así se nota de un vistazo que la lista no está completa.
 */
export function FilterMenu({
  filtros,
  filter,
  onFilter,
  stages,
  stage,
  onStage,
  owners,
  owner,
  onOwner,
  className,
}: {
  filtros: { id: InboxFilter; label: string; count: number }[];
  filter: InboxFilter;
  onFilter: (f: InboxFilter) => void;
  /** Etapas presentes; vacío = sin selector de etapa. */
  stages: string[];
  stage: string;
  onStage: (s: string) => void;
  /** Personas del equipo; `null` = quien mira no ve al equipo (sin selector). */
  owners: [string, string][] | null;
  owner: string;
  onOwner: (o: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = filtros.find((f) => f.id === filter) ?? filtros[0];
  // Filtros además del de "Mostrar": se cuentan en la cápsula.
  const extra = (stage !== "all" ? 1 : 0) + (owners && owner !== "all" ? 1 : 0);
  const filtered = filter !== "all" || extra > 0;

  function clearAll() {
    onFilter("all");
    onStage("all");
    onOwner("all");
  }

  return (
    <div ref={root} className={cn("flex items-center", className)}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Filtrar la bandeja: ${current?.label ?? "Todas"} (${current?.count ?? 0})${
          extra > 0 ? `, ${extra} filtro${extra === 1 ? "" : "s"} más` : ""
        }`}
        className={cn(
          "box-border flex h-6 items-center gap-1 whitespace-nowrap rounded-full border py-0 pl-2 pr-1.5 text-[11.5px] font-semibold leading-none transition-[color,background-color,border-color,transform] duration-150 active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          filtered
            ? "border-brand bg-brand text-brand-fg"
            : "border-border-strong bg-chip text-text-2 hover:border-text-3"
        )}
      >
        {/* Al cambiar de filtro, el nombre entra con un desliz corto. */}
        <m.span
          key={current?.id}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING}
        >
          {current?.label}
        </m.span>
        <span
          className={cn(
            "rounded-full px-1 py-[2px] text-[10.5px] leading-none",
            filtered ? "bg-brand-veil" : "bg-secondary text-text-3"
          )}
        >
          {current?.count}
        </span>
        {extra > 0 && (
          <span className="rounded-full bg-brand-veil px-1 py-[2px] text-[10.5px] leading-none">
            +{extra}
          </span>
        )}
        <m.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING} className="flex">
          <ChevronDown className="h-3 w-3" strokeWidth={2} />
        </m.span>
      </button>

      <AnimatePresence>
        {open && (
          <m.div
            role="dialog"
            aria-label="Filtros de la bandeja"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -2, transition: { duration: 0.1 } }}
            transition={SPRING}
            style={{ transformOrigin: "top left" }}
            // Anclado a la fila del título (no a la cápsula): así nunca se sale
            // por la derecha de la columna, venga la cápsula donde venga.
            className="absolute left-0 top-full z-30 mt-1.5 w-64 max-w-full rounded-md border bg-popover p-1.5 text-foreground shadow-pop"
          >
            <p className="kicker px-2 pb-1 pt-1">Mostrar</p>
            <ul>
              {filtros.map((f, i) => {
                const on = f.id === filter;
                return (
                  <m.li
                    key={f.id}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ ...SPRING, delay: 0.03 + i * 0.02 }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onFilter(f.id);
                        setOpen(false);
                      }}
                      aria-pressed={on}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        on ? "bg-brand-tint font-semibold text-brand-text" : "text-foreground hover:bg-accent"
                      )}
                    >
                      <span className="flex-1">{f.label}</span>
                      <span className="font-mono text-[11px] text-text-3">{f.count}</span>
                      <Check
                        className={cn("h-3.5 w-3.5 shrink-0", on ? "opacity-100" : "opacity-0")}
                        strokeWidth={2}
                        aria-hidden
                      />
                    </button>
                  </m.li>
                );
              })}
            </ul>

            {(stages.length > 0 || owners) && (
              <div className="mt-1.5 space-y-2 border-t px-2 pb-1 pt-2.5">
                {stages.length > 0 && (
                  <label className="block">
                    <span className="kicker mb-1 block">Etapa</span>
                    <select
                      value={stage}
                      onChange={(e) => onStage(e.target.value)}
                      aria-label="Filtrar por etapa del embudo"
                      className={cn(
                        "h-8 w-full rounded-md border bg-card px-2 text-[12.5px]",
                        stage === "all" ? "border-input" : "border-brand"
                      )}
                    >
                      <option value="all">Toda etapa</option>
                      {stages.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {owners && (
                  <label className="block">
                    <span className="kicker mb-1 block">Quién atiende</span>
                    <select
                      value={owner}
                      onChange={(e) => onOwner(e.target.value)}
                      aria-label="Filtrar por persona asignada"
                      className={cn(
                        "h-8 w-full rounded-md border bg-card px-2 text-[12.5px]",
                        owner === "all" ? "border-input" : "border-brand"
                      )}
                    >
                      <option value="all">Todo el equipo</option>
                      <option value="mine">Míos</option>
                      <option value="unassigned">Sin asignar</option>
                      {owners.map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}

            {filtered && (
              <button
                type="button"
                onClick={() => {
                  clearAll();
                  setOpen(false);
                }}
                className="mt-1.5 w-full rounded-sm px-2 py-1.5 text-left text-[12px] font-medium text-brand-text hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Quitar filtros
              </button>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
