"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand-mark";

const COOKIE = "dashfort-splash";

/**
 * Animación de apertura (app móvil, maqueta E): SOLO la primera vez que se
 * abre la app instalada (PWA o APK). Menos de 1 s, solo CSS (transform y
 * opacity, sin tocar el hilo principal). Se apaga con «reducir movimiento».
 * El servidor la pinta solo si no existe la cookie; en una pestaña normal del
 * navegador la CSS la esconde (`display-mode: standalone`) y no cuenta como vista.
 */
export function AppSplash() {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    try {
      if (window.matchMedia("(display-mode: standalone)").matches) {
        document.cookie = `${COOKIE}=1;path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
      }
    } catch {
      /* sin cookie: se vuelve a ver, no pasa nada */
    }
  }, []);
  if (gone) return null;
  return (
    <div className="app-splash" aria-hidden onAnimationEnd={(e) => e.animationName === "splash-out" && setGone(true)}>
      <span className="app-splash-tile">
        <BrandMark className="h-10 w-10 text-white" />
      </span>
    </div>
  );
}

export const SPLASH_COOKIE = COOKIE;
