import { TagsClient } from "@/components/settings/tags-client";
import { requirePagePermission } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function TagsSettingsPage() {
  // 021: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  await requirePagePermission("tags.manage");
  return <TagsClient />;
}
