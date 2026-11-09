"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * «/settings» en escritorio sigue llevando a la primera pestaña; en el
 * teléfono se queda en la lista de secciones (lista → detalle, como WhatsApp).
 */
export function DesktopRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) router.replace(to);
  }, [router, to]);
  return null;
}
