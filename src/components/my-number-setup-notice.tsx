import Link from "next/link";
import type { SessionContext } from "@/lib/auth/session";
import { myNumber } from "@/server/mi-numero/numbers";
import { orgHasMiNumero } from "@/server/modules";

/**
 * Mi número (046) — Aviso discreto para quien tiene un número autorizado y
 * aún no lo termina: primero acepta el aviso y luego escanea su código. Solo
 * lo ve su dueño; un número de empresa lo vincula también su persona. Sin el
 * complemento, o con el número ya vinculado, no pinta nada. Un fallo al leer
 * no tumba la pantalla.
 */
export async function MyNumberSetupNotice({ session }: { session: SessionContext }) {
  let step: "accept" | "link" | null = null;
  try {
    if (!(await orgHasMiNumero(session.organizationId))) return null;
    const mine = await myNumber(session.organizationId, session.userId);
    if (!mine) return null;
    if (!mine.noticeAcceptedAt) step = "accept";
    else if (mine.connection.status !== "connected") step = "link";
  } catch {
    return null;
  }
  if (!step) return null;
  return (
    <div className="border-b bg-card px-4 py-2 text-xs" role="status" data-testid="my-number-setup-notice">
      {step === "accept"
        ? "Autorizaron un número de WhatsApp para ti. Lee el aviso y acéptalo para vincularlo."
        : "Tu número de WhatsApp está autorizado. Escanea tu código para vincularlo."}{" "}
      <Link href="/settings/my-number" className="underline">
        {step === "accept" ? "Ver aviso" : "Vincular"}
      </Link>
    </div>
  );
}
