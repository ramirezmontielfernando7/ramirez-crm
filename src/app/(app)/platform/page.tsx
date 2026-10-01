import { notFound } from "next/navigation";
import { NavRevealButton } from "@/components/nav-mode";
import { PlatformClient } from "@/components/platform/platform-client";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/**
 * Fase 3, PR 2 — Administración de la plataforma: organizaciones (alta,
 * estado, personas) y bitácora. Solo el administrador de plataforma; para
 * cualquier otra persona esta página NO EXISTE (404).
 */
export default async function PlatformPage() {
  const admin = await currentPlatformAdmin();
  if (!admin) notFound();
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
        <NavRevealButton />
        <h2 className="text-[17px] font-bold tracking-tight">Plataforma</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <PlatformClient adminUserId={admin.userId} />
      </div>
    </div>
  );
}
