"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { BarChart3, Bot, Inbox, Kanban, Megaphone, Settings, Sparkles, X, type LucideIcon } from "lucide-react";
import { useViewer } from "@/components/viewer-context";
import { closeTour, getTourState, subscribeTour } from "@/lib/tour-dialog";
import { TOUR, visibleFor, type TourStep } from "@/lib/tutorials";

const ICONS: Record<TourStep["icon"], LucideIcon> = { Inbox, Kanban, Sparkles, Megaphone, BarChart3, Settings, Bot };

/**
 * Recorrido guiado de 1 minuto: una ventana con un paso por pilar del menú
 * (solo los que tiene la empresa y el rol). Se abre desde «Primeros pasos» y
 * desde el menú de la cuenta. Escape o «Cerrar» lo cierra.
 */
export function TourDialog() {
  const { open } = useSyncExternalStore(subscribeTour, getTourState, getTourState);
  const viewer = useViewer();
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const steps = visibleFor(TOUR, viewer);

  useEffect(() => {
    if (!open) return;
    setI(0);
    const previo = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTour();
    };
    document.addEventListener("keydown", onKey);
    box.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previo?.focus?.();
    };
  }, [open]);

  if (!open || steps.length === 0) return null;
  const step = steps[Math.min(i, steps.length - 1)]!;
  const Icon = ICONS[step.icon];
  const last = i >= steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      data-testid="tour-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeTour();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        data-testid="tour-dialog"
        className="relative w-full max-w-[460px] rounded-xl border bg-card p-6 shadow-pop outline-none"
      >
        <button
          type="button"
          onClick={closeTour}
          aria-label="Cerrar recorrido"
          className="absolute right-3 top-3 rounded-md p-1.5 text-text-3 hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-brand-ink">
          Recorrido · {i + 1} de {steps.length}
        </p>
        <span className="mt-3 grid h-11 w-11 place-items-center rounded-full bg-brand-soft text-brand-text">
          <Icon className="h-5 w-5" strokeWidth={1.8} aria-hidden />
        </span>
        <h2 id="tour-title" className="mt-3 text-[19px] font-semibold leading-snug">
          {step.title}
        </h2>
        <p className="mt-2 text-[14px] leading-6 text-text-2" data-testid="tour-body">
          {step.body}
        </p>
        <div className="mt-4 flex items-center gap-1.5" aria-hidden>
          {steps.map((s, n) => (
            <span key={s.key} className={`h-1.5 rounded-full ${n === i ? "w-5 bg-primary" : "w-1.5 bg-subtle"}`} />
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href={step.href}
            onClick={closeTour}
            className="inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium hover:bg-accent"
          >
            {step.cta}
          </Link>
          <span className="flex-1" />
          {i > 0 && (
            <button type="button" onClick={() => setI(i - 1)} className="h-9 rounded-full px-3 text-sm text-text-2 hover:text-foreground">
              Atrás
            </button>
          )}
          <button
            type="button"
            data-testid="tour-next"
            onClick={() => (last ? closeTour() : setI(i + 1))}
            className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            {last ? "Terminar" : "Siguiente"}
          </button>
        </div>
        <p className="mt-4 text-[12.5px] text-text-3">
          ¿Prefieres leerlo con calma?{" "}
          <Link href="/ayuda" onClick={closeTour} className="font-medium text-brand-ink hover:underline">
            Ver todos los tutoriales
          </Link>
        </p>
      </div>
    </div>
  );
}
