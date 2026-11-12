import { withAuth } from "@/lib/api";
import { listWhatsAppNumbers } from "@/server/credentials";

export const dynamic = "force-dynamic";

/**
 * 0080 — Los números oficiales de la empresa, para etiquetar y filtrar los
 * chats de la Bandeja. Lo puede pedir cualquier persona del equipo: solo
 * viaja el nombre que la empresa le puso y el teléfono (jamás el token ni los
 * IDs de Meta de la cuenta).
 */
export const GET = withAuth(async (session) => {
  const numbers = await listWhatsAppNumbers(session.organizationId);
  return Response.json({
    numbers: numbers.map((n) => ({
      id: n.phoneNumberId,
      label: n.label,
      phone: n.displayPhoneNumber,
      name: n.verifiedName,
      isPrimary: n.isPrimary,
    })),
  });
});
