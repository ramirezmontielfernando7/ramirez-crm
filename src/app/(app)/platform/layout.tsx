import { notFound } from "next/navigation";
import { PlatformShell } from "@/components/platform/platform-tabs";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/**
 * Fase 3, PR 2 / 036 (PR 4) — Administración de la plataforma, en pestañas
 * («Mi panel» y «Organizaciones»). Solo el administrador de plataforma; para
 * cualquier otra persona estas páginas NO EXISTEN (404). Cada página lo
 * vuelve a comprobar y las rutas /api/platform/* también.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  if (!(await currentPlatformAdmin())) notFound();
  // 039: el mismo encabezado de 56 px y fila de pestañas que el resto de la app.
  return <PlatformShell>{children}</PlatformShell>;
}
