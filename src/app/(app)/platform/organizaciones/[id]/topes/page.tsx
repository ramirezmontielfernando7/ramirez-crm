import { notFound } from "next/navigation";
import { LimitsSection } from "@/components/platform/organization-detail";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/** 040 — Ficha de la organización → IA y topes. */
export default async function Page() {
  if (!(await currentPlatformAdmin())) notFound();
  return <LimitsSection />;
}
