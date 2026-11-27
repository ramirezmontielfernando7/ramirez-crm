"use client";

import { useEffect, useState } from "react";

/**
 * Efecto de «ir escribiendo» para una respuesta que ya llegó completa.
 * Solo es presentación: el texto real no cambia. Sin animación (`enabled`
 * falso o «reducir movimiento») devuelve el texto entero de inmediato.
 * Dura como máximo ~2.5 s sin importar el largo.
 */
export function useTypewriter(text: string, enabled: boolean): { shown: string; done: boolean } {
  const reduce =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const off = !enabled || reduce || text.length === 0;
  const [n, setN] = useState(off ? text.length : 0);

  useEffect(() => {
    if (off) {
      setN(text.length);
      return;
    }
    const total = Math.min(2500, Math.max(600, text.length * 18));
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / total);
      setN(Math.ceil(p * text.length));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, off]);

  const count = off ? text.length : n;
  return { shown: text.slice(0, count), done: count >= text.length };
}
