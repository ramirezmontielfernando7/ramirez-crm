import { cn, contactInitials } from "@/lib/utils";

/**
 * Avatar de contacto: iniciales (solo letras o números) sobre un tono suave
 * del color de marca, igual en toda la app. Sin iniciales usables (nombre vacío, solo
 * emojis o símbolos) pinta una silueta de persona, como WhatsApp Web.
 * WhatsApp no entrega fotos de perfil, así que no hay foto que mostrar.
 */
export function ContactAvatar({
  name,
  seed,
  size = "md",
  className,
}: {
  className?: string;
  name: string;
  /** Clave estable para el tono del avatar (solo en el estilo Profundo); sin ella, el nombre. */
  seed?: string;
  size?: "xs" | "sm" | "list" | "md" | "lg";
}) {
  const sizes = {
    xs: "h-6 w-6 text-[10px]",
    sm: "h-7 w-7 text-[10px]",
    /** Filas de la Bandeja: densas, como Chatwoot/Twenty. */
    list: "h-8 w-8 text-[11px]",
    md: "h-9 w-9 text-xs",
    lg: "h-14 w-14 text-[18px]",
  } as const;
  const text = contactInitials(name);
  const hue = avatarHue(seed ?? name);
  return (
    <div
      className={cn(
        // brand-soft / brand-text: el tono suave del acento con su texto oscuro
        // (claro) o claro (oscuro); el acento white-label los recalcula.
        "flex shrink-0 items-center justify-center rounded-full bg-[var(--accent-wash)] font-semibold text-brand-text",
        sizes[size],
        className
      )}
      aria-hidden
      data-avatar
      data-hue={hue}
    >
      {text || (
        <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="currentColor" data-avatar-silhouette>
          <circle cx="12" cy="8.5" r="4" />
          <path d="M3.5 21c0-4.4 3.8-7 8.5-7s8.5 2.6 8.5 7z" />
        </svg>
      )}
    </div>
  );
}

/**
 * Uno de seis tonos, estable por persona. Solo lo pinta el estilo «Demfort
 * Profundo» (`[data-ui="depth"] [data-avatar][data-hue]`); Clásico y Premium
 * siguen con el tono de marca.
 */
export function avatarHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 6;
}
