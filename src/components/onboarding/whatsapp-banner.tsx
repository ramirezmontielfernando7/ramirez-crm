"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Auditoría UX 2026-11 (paquete A, maquetas A2 y A3) — el aviso de que aún no
 * hay WhatsApp conectado. Quien puede conectarlo ve el botón; los demás, a
 * quién pedírselo.
 */
export function WhatsAppMissingBanner({
  canConnect,
  message,
  className,
}: {
  canConnect: boolean;
  message: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      data-whatsapp-missing
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b bg-warning-tint px-4 py-2 text-[13px] text-warning-text md:px-5",
        className,
      )}
    >
      <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
      <span className="min-w-0 flex-1">
        {message}
        {!canConnect && " Pídele al Propietario de la cuenta que lo conecte."}
      </span>
      {canConnect && (
        <Link
          href="/settings/whatsapp"
          className="inline-flex h-7 shrink-0 items-center rounded-full border border-current px-3 text-[12.5px] font-semibold hover:bg-surface"
        >
          Conectar ahora
        </Link>
      )}
    </div>
  );
}
