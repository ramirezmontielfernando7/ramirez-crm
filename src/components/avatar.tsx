import { cn, contactInitials } from "@/lib/utils";

/**
 * Avatar de contacto: iniciales (solo letras o números) sobre UN color neutro
 * del tema, igual en toda la app. Sin iniciales usables (nombre vacío, solo
 * emojis o símbolos) pinta una silueta de persona, como WhatsApp Web.
 * WhatsApp no entrega fotos de perfil, así que no hay foto que mostrar.
 */
export function ContactAvatar({
  name,
  size = "md",
}: {
  name: string;
  /** Ya no tiñe el avatar; se acepta para no tocar a quienes aún lo pasan. */
  seed?: string;
  size?: "sm" | "list" | "md" | "lg";
}) {
  const sizes = {
    sm: "h-7 w-7 text-[10px]",
    /** Filas de la Bandeja: densas, como Chatwoot/Twenty. */
    list: "h-8 w-8 text-[11px]",
    md: "h-9 w-9 text-xs",
    lg: "h-12 w-12 text-sm",
  } as const;
  const text = contactInitials(name);
  return (
    <div
      className={cn(
        // secondary / secondary-foreground: --bg-panel con --text-2, tokens del
        // tema (claro y oscuro) con contraste de texto normal (> 4.5:1).
        "flex shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground",
        sizes[size]
      )}
      aria-hidden
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
