import { notFound } from "next/navigation";
import { BillingTab } from "@/components/platform/organization-detail";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/** 048 — Ficha de la organización → Cobro y prueba. */
export default async function Page() {
  if (!(await currentPlatformAdmin())) notFound();
  return <BillingTab />;
}
