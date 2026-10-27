import { notFound, redirect } from "next/navigation";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/**
 * 040 — /platform abre «Mi panel» (036 PR 5) (la bitácora pasó a
 * Administradores y auditoría). Para quien no es administrador, 404.
 */
export default async function PlatformIndexPage() {
  if (!(await currentPlatformAdmin())) notFound();
  redirect("/platform/panel");
}
