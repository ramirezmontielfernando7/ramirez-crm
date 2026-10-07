import { notFound, redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { workSections } from "@/server/work/sections";

export const dynamic = "force-dynamic";

/**
 * 033 — «Trabajo» abre en su primera pestaña encendida: Citas (/bookings,
 * que sigue siendo su dirección) o Tareas. Sin ninguno de los dos módulos,
 * la pantalla no existe para esta organización.
 */
export default async function TrabajoPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const s = await workSections(session.organizationId);
  if (s.citas) redirect("/bookings");
  if (s.tareas) redirect("/trabajo/tareas");
  notFound();
}
