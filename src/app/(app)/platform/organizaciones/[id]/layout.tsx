import { notFound } from "next/navigation";
import { OrganizationShell } from "@/components/platform/organization-detail";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";
import { organizationExists } from "@/server/platform-admin/usage";

export const dynamic = "force-dynamic";

/**
 * 040 — La ficha de una organización en /platform, en cuatro pestañas (Plan y
 * módulos · Topes y visibilidad · Consumo y almacenamiento · Accesos y
 * estado). 404 a quien no es administrador y para un id que no existe.
 */
export default async function OrganizationLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const admin = await currentPlatformAdmin();
  if (!admin) notFound();
  const { id } = await params;
  if (!(await organizationExists(id))) notFound();
  return (
    <OrganizationShell orgId={id} adminUserId={admin.userId}>
      {children}
    </OrganizationShell>
  );
}
