"use client";

import { useViewer } from "@/components/viewer-context";
import { cn } from "@/lib/utils";
import { useTeamUnread } from "./unread-store";

const label = (n: number) => `${n} ${n === 1 ? "mensaje" : "mensajes"} del equipo sin leer`;
const shown = (n: number) => (n > 99 ? "99+" : String(n));

/**
 * 025 — Globo de no leídos del chat de equipo en su renglón del menú
 * (expandido). Con el menú en íconos lo pinta `TeamUnreadLogoBadge` sobre el
 * logo. Solo este globo se repinta al cambiar el número.
 */
export function TeamUnreadRowBadge() {
  const { userId } = useViewer();
  const n = useTeamUnread(userId);
  if (n <= 0) return null;
  return (
    <span
      aria-label={label(n)}
      className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-bold text-brand-fg group-data-[mini]/nav:hidden"
    >
      {shown(n)}
    </span>
  );
}

/**
 * Sobre el logo (el botón del menú): con el menú en íconos (`onlyMini`) o en
 * el botón que lo reabre cuando está oculto. Rojo de alerta con anillo del
 * fondo, para leerse sobre el mosaico de marca.
 */
export function TeamUnreadLogoBadge({ onlyMini = false }: { onlyMini?: boolean }) {
  const { userId } = useViewer();
  const n = useTeamUnread(userId);
  if (n <= 0) return null;
  return (
    <span
      aria-label={label(n)}
      className={cn(
        "pointer-events-none absolute -right-1.5 -top-1.5 z-10 h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white ring-2 ring-subtle",
        onlyMini ? "hidden group-data-[mini]/nav:flex" : "flex"
      )}
    >
      {shown(n)}
    </span>
  );
}
