"use client";

import { useEffect } from "react";

/** Registra el service worker mínimo que muestra «Sin conexión» (public/sw.js). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Un fallo aquí nunca debe afectar al CRM: solo se pierde la pantalla offline.
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
