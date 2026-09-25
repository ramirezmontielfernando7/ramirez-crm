"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import {
  nextThemePreference,
  normalizeThemePreference,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  THEME_LABELS,
  type ThemePreference,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

const ICONS = { light: Sun, dark: Moon } as const;

/** Botón que alterna Claro ⇄ Oscuro y persiste la elección en cookie. */
export function ThemeToggle({
  initial,
  className,
}: {
  initial: ThemePreference;
  className?: string;
}) {
  // Lo pintado gana a la prop: el botón puede montarse de nuevo (la barra
  // colapsada lo lleva en su tarjeta de perfil) después de un cambio de tema,
  // y la prop del servidor ya no sería la verdad.
  const [pref, setPref] = useState<ThemePreference>(() =>
    typeof document === "undefined"
      ? initial
      : normalizeThemePreference(document.documentElement.getAttribute("data-theme") ?? initial)
  );

  function cycle() {
    const value = nextThemePreference(pref);
    setPref(value);
    document.documentElement.setAttribute("data-theme", value);
    document.cookie = `${THEME_COOKIE}=${value};path=/;max-age=${THEME_COOKIE_MAX_AGE};samesite=lax`;
  }

  const Icon = ICONS[pref];
  const label = `Tema: ${THEME_LABELS[pref]}`;

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={`${label} (clic para cambiar)`}
      className={cn(
        "rounded p-1 text-text-3 transition-colors hover:text-foreground",
        className
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.7} />
    </button>
  );
}
