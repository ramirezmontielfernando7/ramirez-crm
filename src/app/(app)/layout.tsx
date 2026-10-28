import { getAdvisorNewChatsBlocked } from "@/server/messaging-settings";
import { redirect } from "next/navigation";
import { runWithOrganization } from "@/lib/request-context";
import { cookies, headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getSessionOrNull } from "@/lib/auth/session";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import { AppShell } from "@/components/app-shell";
import { resolveCommit } from "@/lib/version";
import { campaignsEnabled } from "@/server/campaigns/flag";
import { navForSession } from "@/server/navigation/resolve";
import { toNavEntries } from "@/lib/modules/nav-layout";
import { getUserPreferences } from "@/server/preferences";
import { resolveNavMode } from "@/lib/preferences";
import { DirectDisconnectNotice } from "@/components/direct-disconnect-notice";
import { MyNumberSetupNotice } from "@/components/my-number-setup-notice";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";
import { orgHasMiNumero } from "@/server/modules";
import { hasMyNumber } from "@/server/mi-numero/numbers";
import { seesTeamNumbers } from "@/server/mi-numero/supervise";
import { can } from "@/lib/auth/permissions";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const [branding, prefs] = await runWithOrganization(session.organizationId, () => Promise.all([
    getBranding(session.organizationId),
    getUserPreferences(session.organizationId, session.userId),
  ]));
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });
  // 030 (PR 4): el menú se resuelve aquí (módulos de la organización,
  // permisos del rol y, con custom_nav, el menú del rol). Ocultar es solo
  // estético: cada ruta valida permiso y módulo por su cuenta.
  const nav = await navForSession(session);
  const miNumero = await orgHasMiNumero(session.organizationId);
  const ownNumber = miNumero && (await hasMyNumber(session.organizationId, session.userId));
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );

  return (
    <AppShell
      branding={branding}
      userName={authSession?.user.name ?? "Usuario"}
      role={session.role}
      userId={session.userId}
      grants={session.grants}
      theme={theme}
      // Se resuelve aquí, en el servidor: el cliente no ve `SOURCE_COMMIT`.
      // Baja con su procedencia, para que la insignia no presente como
      // verificado un commit que no salió del build (#50).
      commit={resolveCommit()}
      // Qué módulos opcionales existen se decide en el servidor y baja por
      // prop, igual que los canales de la Bandeja. El nav es un componente de
      // cliente: no puede —ni debe— leer variables de entorno.
      campaigns={await campaignsEnabled(session.organizationId)}
      // Quien tiene un «Mi número» autorizado ve el botón de Ajustes aunque su rol
      // no tenga ninguna otra pestaña: ahí solo verá «Mi número».
      nav={{ ...toNavEntries(nav), settings: nav.settings || ownNumber }}
      modules={nav.modules}
      platform={(await currentPlatformAdmin()) !== null}
      navMode={resolveNavMode(prefs, session.role)}
      // Mi número (046): la pestaña de la Bandeja para quien tiene número y
      // (PR 7) para quien supervisa los números del equipo.
      myNumber={ownNumber}
      teamNumbers={miNumero && can(session, "mi_numero.manage") && (await seesTeamNumbers(session.organizationId, session.userId))}
      newChatsBlocked={session.role === "asesor" && (await getAdvisorNewChatsBlocked(session.organizationId))}
    >
      <DirectDisconnectNotice session={session} />
      <MyNumberSetupNotice session={session} />
      {children}
    </AppShell>
  );
}
