"use client";

import { TAG_COLORS, tagColorClass, type TagColor } from "@/lib/tags";
import { cn } from "@/lib/utils";

export const COLOR_LABEL: Record<TagColor, string> = {
  gris: "Gris",
  azul: "Azul",
  verde: "Verde",
  ambar: "Ámbar",
  rojo: "Rojo",
  morado: "Morado",
};

/** La paleta de la organización (etiquetas, y etapas del pipeline): círculos de radio. */
export function ColorPicker({
  value,
  onChange,
  label = "Color",
  className,
  small,
  onClear,
}: {
  value: TagColor | null;
  onChange: (c: TagColor) => void;
  label?: string;
  className?: string;
  /** Círculos de 20 px (filas compactas). */
  small?: boolean;
  /** Si se pasa, añade «Auto» (quita el color elegido). */
  onClear?: () => void;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} role="radiogroup" aria-label={label}>
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOR_LABEL[c]}
          title={COLOR_LABEL[c]}
          onClick={() => onChange(c)}
          className={cn(
            small ? "h-5 w-5" : "h-6 w-6",
            "rounded-full border",
            tagColorClass(c),
            value === c ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""
          )}
        />
      ))}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-pressed={value === null}
          className={cn(
            "h-5 rounded-full border px-2 text-[11px] text-text-2 hover:bg-accent",
            value === null ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""
          )}
        >
          Auto
        </button>
      )}
    </div>
  );
}
