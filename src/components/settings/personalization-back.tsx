"use client";

import { usePathname } from "next/navigation";

/** Pinta su contenido (el «volver a Apariencia») solo en Marca y Navegación. */
export function PersonalizationBack({ children }: { children: React.ReactNode }) {
  const p = usePathname();
  const detail = p.startsWith("/settings/personalization/marca") || p.startsWith("/settings/personalization/navegacion");
  return detail ? <>{children}</> : null;
}
