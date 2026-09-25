import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { tagColorClass, type TagDto } from "@/lib/tags";

/** 021 — Una etiqueta de contacto, con botón para quitarla si se pasa `onRemove`. */
export function TagChip({
  tag,
  onRemove,
  className,
}: {
  tag: Pick<TagDto, "name" | "color">;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tagColorClass(tag.color),
        className
      )}
    >
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Quitar etiqueta ${tag.name}`}
          className="-mr-0.5 rounded-full p-0.5 opacity-70 hover:opacity-100"
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      )}
    </span>
  );
}
