import { notFound, redirect } from "next/navigation";
import { runWithOrganization } from "@/lib/request-context";
import { BookingsClient } from "@/components/bookings/bookings-client";
import { getSessionOrNull } from "@/lib/auth/session";
import { clampListTo, isCalendarView, isIsoDate } from "@/lib/time/calendar";
import { todayInTz } from "@/lib/time/slots";
import { agendaEnabled } from "@/server/agenda/flag";
import { getSettings } from "@/server/agenda/settings";
import { workSections } from "@/server/work/sections";
import { WorkShell } from "@/components/work/work-shell";

export const dynamic = "force-dynamic";

type Params = { vista?: string; fecha?: string; desde?: string; hasta?: string };

/**
 * 215 — Citas en calendario. La vista y la fecha viven en la URL
 * (`?vista=semana&fecha=2026-09-18`, o `desde`/`hasta` en la Lista) para que
 * recargar o compartir el enlace abra en el mismo sitio.
 *
 * "Hoy" se decide aquí, en la zona del NEGOCIO: el navegador de quien mira
 * puede estar en otra.
 *
 * 033 — Es la pestaña «Citas» de Trabajo: misma dirección (/bookings), con
 * la cabecera y las pestañas de Trabajo arriba. Abre en la Lista.
 */
export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  // Sin el módulo esta pantalla no existe para esta organización.
  if (!(await agendaEnabled(session.organizationId))) notFound();

  const sections = await workSections(session.organizationId);
  const settings = await runWithOrganization(session.organizationId, () =>
    getSettings(session.organizationId)
  );
  const params = await searchParams;
  const view = isCalendarView(params.vista) ? params.vista : null;
  const listFrom = isIsoDate(params.desde) ? params.desde : null;
  const date =
    view === "lista" && listFrom
      ? listFrom
      : isIsoDate(params.fecha)
        ? params.fecha
        : todayInTz(new Date(), settings.timezone);

  return (
    <WorkShell sections={sections}>
      <BookingsClient
        embedded
        initialView={view}
        initialDate={date}
        initialListTo={
          view === "lista" && isIsoDate(params.hasta)
            ? clampListTo(date, params.hasta)
            : null
        }
        timezone={settings.timezone}
        weeklyHours={settings.weeklyHours}
      />
    </WorkShell>
  );
}
