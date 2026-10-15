"use client";

import { DESTINATION_LABEL } from "@/lib/knowledge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * 040 — Biblioteca unificada: las dos insignias de destino de un archivo
 * («💬 Envío en chat» y «🤖 Lectura IA (RAG)») y, para quien puede, sus
 * interruptores. Las usan Biblioteca (CRM Comercial) y Documentos (Estudio
 * de IA): el mismo archivo se ve igual en las dos.
 */
export type Destination = "chat" | "rag";

export function DestinationBadges({ chat, rag, className }: { chat: boolean; rag: boolean | null; className?: string }) {
  if (!chat && !rag) return null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)} data-testid="library-destinations">
      {chat && (
        <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-medium text-brand-text" data-testid="dest-chat">
          {DESTINATION_LABEL.chat}
        </span>
      )}
      {rag && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-text-2" data-testid="dest-rag">
          {DESTINATION_LABEL.rag}
        </span>
      )}
    </span>
  );
}

/** Un interruptor de destino con su etiqueta (y por qué está bloqueado, si lo está). */
export function DestinationToggle({
  destination,
  checked,
  disabled,
  hint,
  onChange,
  name,
}: {
  destination: Destination;
  checked: boolean;
  disabled?: boolean;
  hint?: string | null;
  onChange: (next: boolean) => void;
  /** Para el nombre accesible: de qué archivo es. */
  name: string;
}) {
  return (
    <label
      className={cn("flex items-center gap-2 text-xs", disabled ? "text-text-3" : "text-text-2")}
      title={hint ?? undefined}
      data-testid={`dest-toggle-${destination}`}
    >
      <Switch
        size="sm"
        checked={checked}
        disabled={disabled}
        label={`${DESTINATION_LABEL[destination]}: ${name}`}
        onCheckedChange={onChange}
      />
      {DESTINATION_LABEL[destination]}
    </label>
  );
}
