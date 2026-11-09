/**
 * Fechas cortas para tarjetas y tablas (Pipeline y Contactos, ronda 3):
 * «hace 2 min», «hace 3 h», «Ayer», «Lun», «8 nov». Puras: `now` se puede
 * pasar para probarlas.
 */

const DIA_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Días de calendario entre `d` y `now` (0 = hoy, 1 = ayer). */
function daysAgo(d: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
}

function dayLabel(d: Date, now: Date): string {
  const days = daysAgo(d, now);
  if (days === 1) return "Ayer";
  if (days > 1 && days < 7) return DIA_SEMANA[d.getDay()] ?? "";
  return `${d.getDate()} ${MESES[d.getMonth()] ?? ""}`;
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Tarjeta del Pipeline: «hace 2 min», «hace 3 h» (hoy), «Ayer», «Lun», «8 nov». */
export function agoShort(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parse(iso);
  if (!d) return "";
  if (daysAgo(d, now) <= 0) {
    const min = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 60_000));
    if (min < 1) return "hace un momento";
    if (min < 60) return `hace ${min} min`;
    return `hace ${Math.floor(min / 60)} h`;
  }
  return dayLabel(d, now);
}

/** Columna «Último mensaje» de Contactos: «Hoy», «Ayer», «Lun», «8 nov». */
export function dayShort(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parse(iso);
  if (!d) return "";
  if (daysAgo(d, now) <= 0) return "Hoy";
  return dayLabel(d, now);
}
