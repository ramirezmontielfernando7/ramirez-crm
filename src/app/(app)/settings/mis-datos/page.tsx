import { DataExportCard } from "@/components/settings/data-export-card";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { SettingsHeader } from "@/components/settings/settings-header";

export const dynamic = "force-dynamic";

/** Ajustes → Mis datos (049): descargar todo lo que tienes en Dashfort. */
export default async function MyDataPage() {
  await requirePagePermission("data.export");
  return (
    <div className="space-y-6">
      <SettingsHeader title="Mis datos" description="Tus datos son tuyos. Descárgalos cuando quieras, sin pedirle permiso a nadie." />
      <DataExportCard />
    </div>
  );
}
