import { notFound } from "next/navigation";
import { ConnectorSettingsClient } from "@/components/ai-connector/connector-settings-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { orgHasConectorIa } from "@/server/modules";

export const dynamic = "force-dynamic";

/** 047 PR 3 — Ajustes del conector de IA (Propietario). Sin el complemento: 404. */
export default async function ConnectorSettingsPage() {
  const session = await requirePagePermission("settings.manage");
  if (!(await orgHasConectorIa(session.organizationId))) notFound();
  return <ConnectorSettingsClient />;
}
