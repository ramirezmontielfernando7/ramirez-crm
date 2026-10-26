import { isNull } from "drizzle-orm";
import Link from "next/link";
import { can } from "@/lib/auth/permissions";
import type { SessionContext } from "@/lib/auth/session";
import { DIRECT_TEXT } from "@/lib/direct-connection";
import { runWithOrganization } from "@/lib/request-context";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { orgHasConexionDirecta } from "@/server/modules";

/**
 * Conexión directa (PR 2) — Aviso discreto cuando el dispositivo vinculado se
 * desconectó. Solo para quien puede vincular y solo con el complemento
 * encendido; en cualquier otro caso no pinta nada. Un fallo al leer no
 * tumba la pantalla.
 */
export async function DirectDisconnectNotice({ session }: { session: SessionContext }) {
  try {
    if (!can(session, "direct_connection.link")) return null;
    if (!(await orgHasConexionDirecta(session.organizationId))) return null;
    const [row] = await runWithOrganization(session.organizationId, () =>
      getDb()
        .select({ status: schema.directConnection.status })
        .from(schema.directConnection)
        .where(scoped(schema.directConnection.organizationId, session.organizationId, isNull(schema.directConnection.directNumberId)))
        .limit(1)
    );
    if (row?.status !== "disconnected") return null;
  } catch {
    return null;
  }
  return (
    <div className="border-b bg-card px-4 py-2 text-xs" role="status" data-testid="direct-disconnect-notice">
      {DIRECT_TEXT.disconnected}{" "}
      <Link href="/settings/direct-connection" className="underline">
        Vincular
      </Link>
    </div>
  );
}
