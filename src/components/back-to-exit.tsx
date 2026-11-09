"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/** Pantallas raíz de la barra de abajo: ahí «Regresar» pide confirmar la salida. */
const ROOTS = new Set(["/inbox", "/pipeline", "/lab", "/campaigns", "/results", "/chat", "/asistente", "/settings"]);
const WINDOW_MS = 2000;

/**
 * «Regresar» de Android, como WhatsApp (solo en la app instalada, PWA/APK):
 * en una pantalla principal, el primer «Regresar» avisa «Presiona otra vez
 * para salir» y el segundo, dentro de 2 s, cierra la app; con un chat abierto
 * primero lo cierra. En pantallas internas no hace nada (regresa a la anterior).
 * Copia el `history.state` de Next al entrada guardia, o Next recargaría la página.
 */
export function BackToExit() {
  const pathname = usePathname();
  const router = useRouter();
  const [toast, setToast] = useState(false);

  useEffect(() => {
    if (!ROOTS.has(pathname)) return;
    let standalone = false;
    try {
      standalone =
        window.matchMedia("(display-mode: standalone)").matches &&
        window.matchMedia("(max-width: 1023px)").matches;
    } catch {
      /* sin matchMedia: no se activa */
    }
    if (!standalone) return;

    let armedUntil = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guard = () => window.history.pushState(window.history.state, "", window.location.href);
    guard();

    const onPop = () => {
      // Chat abierto: «Regresar» lo cierra, no sale.
      if (document.documentElement.hasAttribute("data-chat-open")) {
        document.querySelector<HTMLElement>('[aria-label="Volver a las conversaciones"]')?.click();
        guard();
        return;
      }
      // Otra pestaña (CRM, Marketing, Ajustes…): primero a la Bandeja.
      if (pathname !== "/inbox") {
        setTimeout(() => router.replace("/inbox"), 50);
        return;
      }
      if (Date.now() < armedUntil) {
        armedUntil = 0;
        window.removeEventListener("popstate", onPop);
        // Vuelve al primer registro del historial y de ahí sale: la app se cierra.
        const steps = window.history.length - 1;
        if (steps > 0) {
          window.addEventListener("popstate", () => window.history.back(), { once: true });
          window.history.go(-steps);
        } else {
          window.history.back();
        }
        return;
      }
      armedUntil = Date.now() + WINDOW_MS;
      setToast(true);
      clearTimeout(timer);
      timer = setTimeout(() => setToast(false), WINDOW_MS);
      guard();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      clearTimeout(timer);
      setToast(false);
    };
  }, [pathname, router]);

  if (!toast) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-6 lg:hidden"
    >
      <span className="rounded-full bg-[#1f2937] px-4 py-2 text-[13.5px] text-white shadow-lg">
        Presiona otra vez para salir
      </span>
    </div>
  );
}
