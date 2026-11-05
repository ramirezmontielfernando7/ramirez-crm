"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { UsagePlanClient } from "@/components/usage/usage-plan-client";
import { useViewer } from "@/components/viewer-context";
import { closeUsageDialog, getUsageDialogState, openUsageDialog, subscribeUsageDialog } from "@/lib/usage-dialog";

/**
 * «Uso y plan» como ventana centrada que oscurece lo de atrás (solo el
 * Propietario: `usage.read`). Estilo en `globals.css` (`.usage-overlay`,
 * `.usage-modal`): degradado suave y borde de luz; la animación es CSS corto y
 * se apaga con «reducir movimiento» o en equipos modestos (`data-lite`).
 */
export function UsageDialog() {
  const viewer = useViewer();
  const allowed = viewer.can("usage.read");
  const { open } = useSyncExternalStore(subscribeUsageDialog, getUsageDialogState, getUsageDialogState);
  const box = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();

  // La dirección vieja (`/settings/uso` → `/inbox?uso=1`) abre la ventana y limpia la URL.
  useEffect(() => {
    if (!allowed || params.get("uso") !== "1") return;
    openUsageDialog();
    const next = new URLSearchParams(params.toString());
    next.delete("uso");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [allowed, params, pathname, router]);

  // Escape cierra, el fondo no se desplaza y el foco entra y vuelve.
  useEffect(() => {
    if (!open) return;
    // Equipos modestos: sin desenfoque ni animación (el diseño queda igual, estático).
    const nav = navigator as Navigator & { deviceMemory?: number };
    if ((nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4) document.documentElement.dataset.lite = "1";
    const previo = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeUsageDialog();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previo?.focus?.();
    };
  }, [open]);

  // Al cambiar de pantalla (no al montar), se cierra.
  const antes = useRef(pathname);
  useEffect(() => {
    if (antes.current !== pathname) closeUsageDialog();
    antes.current = pathname;
  }, [pathname]);

  if (!allowed || !open) return null;
  return (
    <div
      className="usage-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      data-testid="usage-dialog-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeUsageDialog();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="usage-dialog-title"
        tabIndex={-1}
        data-testid="usage-dialog"
        className="usage-modal relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[760px] flex-col overflow-hidden outline-none"
      >
        <div className="flex items-center gap-3 px-6 pb-1 pt-5">
          <h1 id="usage-dialog-title" className="text-lg font-semibold tracking-tight">
            Uso y plan
          </h1>
          <button
            type="button"
            onClick={closeUsageDialog}
            aria-label="Cerrar"
            data-testid="usage-dialog-close"
            className="ml-auto rounded-md p-1.5 text-text-3 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <UsagePlanClient embedded />
        </div>
      </div>
    </div>
  );
}
