"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import {
  ONBOARDING_STEP,
  currentStep,
  doneCount,
  type OnboardingState,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";

/**
 * Auditoría UX 2026-11 (paquete A, maqueta A1) — «Primeros pasos»: lo que le
 * falta al Propietario para que su WhatsApp y su agente queden listos. El paso
 * que toca va resaltado con su botón; los demás solo se leen.
 */
export function OnboardingCard({
  state,
  onHide,
  className,
}: {
  state: OnboardingState;
  onHide: () => void;
  className?: string;
}) {
  const current = currentStep(state);
  const total = state.steps.length;
  const done = doneCount(state);
  const withAgent = total > 2;

  return (
    <section
      data-onboarding
      aria-labelledby="onboarding-title"
      className={cn(
        "w-full max-w-[560px] overflow-hidden rounded-xl border bg-card text-left shadow-sm",
        className,
      )}
    >
      <div className="space-y-2 px-5 pb-4 pt-5">
        <p className="text-[11.5px] font-semibold text-brand-ink">
          <span className="uppercase tracking-wide">Primeros pasos</span> · {done} de {total}{" "}
          {done === 1 ? "listo" : "listos"}
        </p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label="Avance de los primeros pasos"
          className="h-1.5 overflow-hidden rounded-full bg-subtle"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${(done / total) * 100}%` }}
          />
        </div>
        <h2 id="onboarding-title" className="pt-1 text-[21px] font-semibold leading-tight">
          ¡Te damos la bienvenida!
        </h2>
        <p className="text-sm text-text-2">
          {withAgent
            ? "En unos minutos tu WhatsApp queda conectado y tu agente de IA listo para contestar."
            : "En unos minutos tu WhatsApp queda conectado y tus chats llegan aquí."}
        </p>
      </div>

      <ol className="border-t">
        {state.steps.map((s, i) => {
          const step = ONBOARDING_STEP[s.key];
          const isCurrent = s.key === current;
          return (
            <li
              key={s.key}
              data-onboarding-step={s.key}
              data-done={s.done ? "true" : undefined}
              className={cn(
                "flex items-start gap-3 border-b px-4 py-3.5 last:border-b-0",
                isCurrent && "bg-[var(--accent-wash)]",
              )}
            >
              {s.done ? (
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-success text-white">
                  <Check className="h-4 w-4" strokeWidth={2.4} aria-hidden />
                  <span className="sr-only">Listo:</span>
                </span>
              ) : (
                <span
                  className={cn(
                    "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[13px] font-medium",
                    isCurrent ? "border-primary text-brand-ink" : "text-text-3",
                  )}
                >
                  {i + 1}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p
                    className={cn(
                      "text-[14.5px] font-medium",
                      s.done && "text-text-3 line-through",
                    )}
                  >
                    {step.title}
                  </p>
                  {!s.done && !isCurrent && step.minutes && (
                    <span className="shrink-0 text-[11.5px] text-text-3">{step.minutes} min</span>
                  )}
                </div>
                {!s.done && step.body && (
                  <p className="mt-0.5 text-[13px] leading-5 text-text-2">{step.body}</p>
                )}
                {isCurrent && step.cta && step.href && (
                  <Link
                    href={step.href}
                    className="mt-3 inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {step.cta}
                    {step.minutes ? ` · ${step.minutes} min` : ""}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-subtle px-4 py-2.5 text-[13px]">
        <Link href="/settings/team" className="font-medium text-brand-ink hover:underline">
          + Invita a tu equipo
        </Link>
        <Link href="/contacts" className="font-medium text-brand-ink hover:underline">
          + Importa tus contactos
        </Link>
        <button
          type="button"
          onClick={onHide}
          className="ml-auto text-text-3 hover:text-foreground"
        >
          Ocultar guía
        </button>
      </div>
    </section>
  );
}
