import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { MyNumberInbox } from "@/components/inbox/my-number-inbox";
import { getSessionOrNull } from "@/lib/auth/session";
import { hasMyNumber } from "@/server/mi-numero/numbers";
import { orgHasMiNumero } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * Mi número (046), PR 4 — La pestaña «Mi número» de la Bandeja: solo para
 * quien tiene su número (la API decide de quién son los chats por la sesión).
 * Sin el complemento o sin número: 404.
 */
export default async function MyNumberInboxPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (!(await orgHasMiNumero(session.organizationId))) notFound();
  if (!(await hasMyNumber(session.organizationId, session.userId))) notFound();
  return (
    <Suspense>
      <MyNumberInbox />
    </Suspense>
  );
}
