import { notFound, redirect } from "next/navigation";
import { MyNumberClient } from "@/components/settings/my-number-client";
import { getSessionOrNull } from "@/lib/auth/session";
import { orgHasMiNumero } from "@/server/modules";

export const dynamic = "force-dynamic";

/**
 * Mi número (046) — Los ajustes del número de quien mira (cualquier rol; la
 * API decide de quién es por la sesión). Sin el complemento: 404.
 */
export default async function MyNumberPage() {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (!(await orgHasMiNumero(session.organizationId))) notFound();
  return <MyNumberClient />;
}
