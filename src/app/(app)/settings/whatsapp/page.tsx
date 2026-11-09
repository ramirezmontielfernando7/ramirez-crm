import { AdvisorNewChatsCard } from "@/components/settings/advisor-new-chats-card";
import { OptOutSettings } from "@/components/settings/opt-out-settings";
import { WhatsappWizard } from "@/components/settings/whatsapp-wizard";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { can } from "@/lib/auth/permissions";
import { orgHasConexionDirecta } from "@/server/modules";

export const dynamic = "force-dynamic";

export default async function WhatsappSettingsPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  const session = await requirePagePermission("settings.manage");
  const direct = can(session, "direct_connection.link") && (await orgHasConexionDirecta(session.organizationId));
  return (
    <div className="space-y-6">
      <WhatsappWizard />
      {direct && (
        <Link
          href="/settings/direct-connection"
          className="flex max-w-5xl items-center justify-between rounded-lg border bg-card px-5 py-4 text-sm hover:bg-subtle"
        >
          <span>
            <span className="font-semibold">Teléfono vinculado</span>
            <span className="ml-2 rounded-full border px-2 py-0.5 text-xs">Complemento</span>
            <span className="mt-1 block text-muted-foreground">
              Vincula un celular con código QR y elige por dónde salen los chats nuevos.
            </span>
          </span>
          <span aria-hidden>›</span>
        </Link>
      )}
      <OptOutSettings />
      <AdvisorNewChatsCard />
    </div>
  );
}
