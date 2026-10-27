import { SettingsShell } from "@/components/settings/settings-nav";
import { SETTINGS_OPEN_TABS, SETTINGS_TAB_PERMISSION } from "@/lib/auth/page-guard";
import { can } from "@/lib/auth/permissions";
import { getSessionOrNull } from "@/lib/auth/session";
import { agendaEnabled } from "@/server/agenda/flag";
import { atribucionEnabled } from "@/server/attribution/flag";
import { isChannelEnabled } from "@/server/channels/enabled";
import { campaignsEnabled } from "@/server/campaigns/flag";
import { hasMyNumber } from "@/server/mi-numero/numbers";
import { orgHasConectorIa, orgHasConexionDirecta, orgHasMiNumero } from "@/server/modules";
import { mayConnect } from "@/server/ai-connector/keys";
import { runWithOrganization } from "@/lib/request-context";

// Los módulos se leen en cada petición: si esto se resolviera al construir,
// encenderlos desde /platform no haría nada.
export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 020: solo las pestañas que el rol puede abrir.
  const session = await getSessionOrNull();
  const allowed = Object.entries(SETTINGS_TAB_PERMISSION)
    .filter(([, permission]) => session && can(session, permission))
    .map(([tab]) => tab);
  // Fase D: Personalización (Apariencia) es de cualquier persona con sesión.
  if (session) allowed.push(...SETTINGS_OPEN_TABS);
  // Fase 3, PR 3: las pestañas de los módulos, los de ESTA organización.
  const org = session?.organizationId;
  const [agenda, atribucion, messenger, campaigns, directConnection, miNumero, conectorIa] = org
    ? await Promise.all([
        agendaEnabled(org),
        atribucionEnabled(org),
        isChannelEnabled(org, "messenger"),
        // 030 (PR 4): con Campañas, Plantillas vive en Campañas.
        campaignsEnabled(org),
        orgHasConexionDirecta(org),
        orgHasMiNumero(org),
        orgHasConectorIa(org),
      ])
    : [false, false, false, false, false, false, false];
  // 046: «Mi número» lo ve quien tiene uno autorizado (de cualquier rol).
  if (session && miNumero && (await hasMyNumber(session.organizationId, session.userId))) allowed.push("my-number");
  // 047: «Mi IA» la ve quien puede conectar su IA (el Propietario decide los roles).
  if (session && conectorIa && (await runWithOrganization(session.organizationId, () => mayConnect(session)))) {
    allowed.push("mi-ia");
  }
  // 039: Ajustes en 5 pestañas con el encabezado de 56 px de toda la app.
  return (
    <SettingsShell
      agenda={agenda}
      atribucion={atribucion}
      messenger={messenger}
      directConnection={directConnection}
      miNumero={miNumero}
      conectorIa={conectorIa}
      templates={!campaigns}
      allowed={allowed}
    >
      {children}
    </SettingsShell>
  );
}
