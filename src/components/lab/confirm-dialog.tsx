"use client";

import { Button } from "@/components/ui/button";

/**
 * 031 (A2) — Diálogo de confirmación simple (mismo patrón visual que los
 * demás diálogos del CRM). Escape y clic afuera cancelan.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancelar",
  busy = false,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={onCancel}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-lg border bg-popover p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 font-semibold">{title}</h3>
        <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "destructive" : "default"} onClick={onConfirm} disabled={busy}>
            {busy ? "Un momento…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
