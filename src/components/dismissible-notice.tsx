"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

/**
 * Aviso de una línea arriba del contenido que se puede cerrar con la ✕.
 * Cerrado se queda así el resto de la sesión del navegador (por pestaña) y
 * vuelve a salir en la siguiente, si sigue aplicando. Sin `sessionStorage`
 * (modo privado, bloqueado) simplemente se cierra hasta recargar.
 */
export function DismissibleNotice({ id, children, testId }: { id: string; children: React.ReactNode; testId?: string }) {
  const key = `vocero.notice.${id}`;
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(key) === "1") setHidden(true);
    } catch {}
  }, [key]);
  if (hidden) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-card px-4 py-2 text-xs" role="status" data-testid={testId}>
      <p className="min-w-0 flex-1">{children}</p>
      <button
        type="button"
        aria-label="Cerrar aviso"
        title="Cerrar aviso"
        onClick={() => {
          setHidden(true);
          try {
            sessionStorage.setItem(key, "1");
          } catch {}
        }}
        className="shrink-0 rounded p-1 text-text-3 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
