import { notFound } from "next/navigation";
import { PlanModulesSection } from "@/components/platform/organization-detail";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/** 040 — Ficha de la organización → Plan y módulos. */
export default async function Page() {
  if (!(await currentPlatformAdmin())) notFound();
  return <PlanModulesSection />;
}
