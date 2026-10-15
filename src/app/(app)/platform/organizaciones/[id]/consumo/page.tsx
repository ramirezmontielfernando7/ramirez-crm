import { notFound } from "next/navigation";
import { UsageSection } from "@/components/platform/organization-detail";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/** 040 — Ficha de la organización → Consumo y almacenamiento. */
export default async function Page() {
  if (!(await currentPlatformAdmin())) notFound();
  return <UsageSection />;
}
