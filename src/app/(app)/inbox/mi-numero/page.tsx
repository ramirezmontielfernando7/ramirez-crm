import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { MyNumberInbox } from "@/components/inbox/my-number-inbox";
import { getSessionOrNull } from "@/lib/auth/session";
import { hasMyNumber } from "@/server/mi-numero/numbers";
import { seesTeamNumbers } from "@/server/mi-numero/supervise";
import { orgHasMiNumero } from "@/server/modules";
import { can } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

/**
 * Mi número (046), PR 4 — La pestaña «Mi número» de la Bandeja: solo para
 * quien tiene su número (la API decide de quién son los chats por la sesión)
 * y (PR 7) para quien supervisa los números del equipo. Sin el complemento,
 * o sin número ni nada que supervisar: 404.
 */
export default async function MyNumberInboxPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (!(await orgHasMiNumero(session.organizationId))) notFound();
  const own = await hasMyNumber(session.organizationId, session.userId);
  const team = can(session, "mi_numero.manage") && (await seesTeamNumbers(session.organizationId, session.userId));
  if (!own && !team) notFound();
  return (
    <Suspense>
      <MyNumberInbox own={own} team={team} />
    </Suspense>
  );
}
