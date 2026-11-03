"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { AssistantSpeed } from "@/lib/assistant-engine";

const KEY = "assistant-speed";

const OPTIONS: { value: AssistantSpeed; label: string; hint: string }[] = [
  { value: "fast", label: "Rápido", hint: "Modo ahorro: respuestas ágiles y de bajo consumo." },
  { value: "deep", label: "Análisis profundo", hint: "Piensa más a fondo para análisis y casos difíciles; consume más crédito." },
];

/** Rápido por defecto; la elección se recuerda en este navegador (solo comodidad). */
export function useAssistantSpeed(): [AssistantSpeed, (s: AssistantSpeed) => void] {
  const [speed, setSpeed] = useState<AssistantSpeed>("fast");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(KEY) === "deep") setSpeed("deep");
    } catch {
      /* sin almacenamiento: se queda en Rápido */
    }
  }, []);
  return [
    speed,
    (s) => {
      setSpeed(s);
      try {
        window.localStorage.setItem(KEY, s);
      } catch {
        /* nada */
      }
    },
  ];
}

export function SpeedPicker({ value, onChange, className }: { value: AssistantSpeed; onChange: (s: AssistantSpeed) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Modo del asistente" data-testid="assistant-speed" className={cn("inline-flex rounded-full bg-secondary p-0.5 text-xs", className)}>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          data-testid={`assistant-speed-${o.value}`}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-3 py-1 font-medium transition-colors",
            value === o.value ? "bg-background text-foreground shadow-sm" : "text-text-3 hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
