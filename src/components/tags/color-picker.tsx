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
}: {
  value: TagColor | null;
  onChange: (c: TagColor) => void;
  label?: string;
  className?: string;
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
            "h-6 w-6 rounded-full border",
            tagColorClass(c),
            value === c ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""
          )}
        />
      ))}
    </div>
  );
}
