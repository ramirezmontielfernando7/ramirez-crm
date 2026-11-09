"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 1023px)";

/** ¿Es una pantalla de teléfono/tableta (< lg)? En el servidor, no. */
export function usePhone(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
