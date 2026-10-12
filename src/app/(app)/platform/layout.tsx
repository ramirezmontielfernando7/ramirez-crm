import { notFound } from "next/navigation";
import { NavRevealButton } from "@/components/nav-mode";
import { PlatformTabs } from "@/components/platform/platform-tabs";
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
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 pt-3 sm:px-6 sm:pt-4">
        <div className="flex items-center gap-2">
          <NavRevealButton />
          <h2 className="text-[17px] font-bold tracking-tight">Plataforma</h2>
        </div>
        <PlatformTabs />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">{children}</div>
    </div>
  );
}
