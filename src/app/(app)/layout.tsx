import { getAdvisorNewChatsBlocked } from "@/server/messaging-settings";
import { redirect } from "next/navigation";
import { runWithOrganization } from "@/lib/request-context";
import { cookies } from "next/headers";
import { getAuthSession, getSessionOrNull } from "@/lib/auth/session";
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
  // Todo lo que pinta el marco se pide A LA VEZ (antes eran ~10 viajes a la
  // base uno tras otro antes de mandar el primer byte de la pantalla).
  const org = session.organizationId;
  const [branding, prefs, authSession, nav, miNumero, campaigns, platformAdmin, newChatsBlocked, cookieJar] =
    await Promise.all([
      runWithOrganization(org, () => getBranding(org)),
      runWithOrganization(org, () => getUserPreferences(org, session.userId)),
      getAuthSession(),
      // 030 (PR 4): el menú se resuelve aquí (módulos de la organización,
      // permisos del rol y, con custom_nav, el menú del rol). Ocultar es solo
      // estético: cada ruta valida permiso y módulo por su cuenta.
      navForSession(session),
      orgHasMiNumero(org),
      campaignsEnabled(org),
      currentPlatformAdmin(),
      session.role === "asesor"
        ? runWithOrganization(org, () => getAdvisorNewChatsBlocked(org))
        : Promise.resolve(false),
      cookies(),
    ]);
  const [ownNumber, teamNumbers] = miNumero
    ? await Promise.all([
        hasMyNumber(org, session.userId),
        can(session, "mi_numero.manage") ? seesTeamNumbers(org, session.userId) : Promise.resolve(false),
      ])
    : [false, false];
  const theme = normalizeThemePreference(cookieJar.get(THEME_COOKIE)?.value);

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
      campaigns={campaigns}
      // Quien tiene un «Mi número» autorizado ve el botón de Ajustes aunque su rol
      // no tenga ninguna otra pestaña: ahí solo verá «Mi número».
      nav={{ ...toNavEntries(nav), settings: nav.settings || ownNumber }}
      modules={nav.modules}
      platform={platformAdmin !== null}
      navMode={resolveNavMode(prefs, session.role)}
      // Mi número (046): la pestaña de la Bandeja para quien tiene número y
      // (PR 7) para quien supervisa los números del equipo.
      myNumber={ownNumber}
      teamNumbers={teamNumbers}
      newChatsBlocked={newChatsBlocked}
    >
      <DirectDisconnectNotice session={session} />
      <MyNumberSetupNotice session={session} />
      {children}
    </AppShell>
  );
}
