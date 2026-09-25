import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getSessionOrNull } from "@/lib/auth/session";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import { AppShell } from "@/components/app-shell";
import { resolveCommit } from "@/lib/version";
import { agendaEnabled } from "@/server/agenda/flag";
import { campaignsEnabled } from "@/server/campaigns/flag";
import { getUserPreferences } from "@/server/preferences";
import { resolveNavCollapsed } from "@/lib/preferences";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const [branding, prefs] = await Promise.all([
    getBranding(session.organizationId),
    getUserPreferences(session.organizationId, session.userId),
  ]);
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );

  return (
    <AppShell
      branding={branding}
      userName={authSession?.user.name ?? "Usuario"}
      role={session.role}
      userId={session.userId}
      theme={theme}
      // Se resuelve aquí, en el servidor: el cliente no ve `SOURCE_COMMIT`.
      // Baja con su procedencia, para que la insignia no presente como
      // verificado un commit que no salió del build (#50).
      commit={resolveCommit()}
      // Qué módulos opcionales existen se decide en el servidor y baja por
      // prop, igual que los canales de la Bandeja. El nav es un componente de
      // cliente: no puede —ni debe— leer variables de entorno.
      agenda={agendaEnabled()}
      campaigns={campaignsEnabled()}
      navCollapsed={resolveNavCollapsed(prefs.navCollapsed, session.role)}
    >
      {children}
    </AppShell>
  );
}
