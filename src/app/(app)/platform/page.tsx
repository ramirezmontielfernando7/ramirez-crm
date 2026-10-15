import { notFound, redirect } from "next/navigation";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/**
 * 040 — /platform abre «Organizaciones y Planes» (la bitácora pasó a
 * Administradores y auditoría). Para quien no es administrador, 404.
 */
export default async function PlatformIndexPage() {
  if (!(await currentPlatformAdmin())) notFound();
  redirect("/platform/organizaciones");
}
