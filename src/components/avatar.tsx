import { avatarColor, cn, initials } from "@/lib/utils";

/** Avatar de contacto: iniciales sobre color estable (FR-006). */
export function ContactAvatar({
  name,
  seed,
  size = "md",
}: {
  name: string;
  /** Semilla del color (id o teléfono): estable para el mismo contacto. */
  seed: string;
  size?: "sm" | "list" | "md" | "lg";
}) {
  const sizes = {
    sm: "h-7 w-7 text-[10px]",
    /** Filas de la Bandeja: densas, como Chatwoot/Twenty. */
    list: "h-8 w-8 text-[11px]",
    md: "h-9 w-9 text-xs",
    lg: "h-12 w-12 text-sm",
  } as const;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        sizes[size],
        avatarColor(seed)
      )}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}
