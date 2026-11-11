"use client";

import Link from "next/link";
import { GraduationCap, Play } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { useViewer } from "@/components/viewer-context";
import { openTour } from "@/lib/tour-dialog";
import { TUTORIALS, visibleFor } from "@/lib/tutorials";

/** «Tutoriales»: el recorrido de 1 minuto y una guía corta por tarea. */
export function HelpClient() {
  const viewer = useViewer();
  const items = visibleFor(TUTORIALS, viewer);
  return (
    <PageShell
      pillar={false}
      title="Tutoriales"
      icon={GraduationCap}
      actions={
        <button
          type="button"
          onClick={openTour}
          data-testid="help-start-tour"
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          <Play className="h-3.5 w-3.5" aria-hidden /> Recorrido de 1 minuto
        </button>
      }
    >
      <div className="mx-auto w-full max-w-3xl space-y-3 px-4 py-6 sm:px-0">
        <p className="text-sm text-text-2">
          Guías cortas para empezar. Cada una dice los pasos y te lleva a la pantalla para hacerlo.
        </p>
        {items.length === 0 ? (
          <EmptyState icon={GraduationCap} title="Aún no hay tutoriales para tu cuenta" />
        ) : (
          items.map((t) => (
            <details key={t.key} data-testid={`tutorial-${t.key}`} className="group rounded-xl border bg-card">
              <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">{t.title}</p>
                  <p className="mt-0.5 text-[13px] text-text-2">{t.summary}</p>
                </div>
                <span className="shrink-0 pt-0.5 text-[12px] text-text-3">{t.minutes} min</span>
              </summary>
              <div className="border-t px-4 pb-4 pt-3">
                <ol className="list-decimal space-y-1.5 pl-5 text-[14px] leading-6">
                  {t.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                {t.tip && <p className="mt-3 rounded-md bg-subtle px-3 py-2 text-[13px] text-text-2">💡 {t.tip}</p>}
                <Link
                  href={t.href}
                  className="mt-4 inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  {t.cta}
                </Link>
              </div>
            </details>
          ))
        )}
      </div>
    </PageShell>
  );
}
