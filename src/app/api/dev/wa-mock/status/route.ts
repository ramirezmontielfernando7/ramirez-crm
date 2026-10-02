import { eq } from "drizzle-orm";
import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { getSystemDb, schema } from "@/lib/db";
import { runWithOrganization } from "@/lib/request-context";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import {
  buildStatusPayload,
  deliverToWebhook,
} from "@/server/dev/wa-mock-inbound";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  waMessageId: z.string().min(1),
  status: z.enum(["sent", "delivered", "read", "failed"]),
  /** Reproduce el `errors[]` que Meta adjunta a los `failed`. */
  errorCode: z.number().int().optional(),
  errorMessage: z.string().optional(),
  /** Campañas v2: objeto `pricing` (billable, pricing_model, category, type). */
  pricing: z.record(z.unknown()).optional(),
  /** Campañas v2: hora del estado en segundos Unix (para probar llegadas fuera de orden). */
  timestamp: z.number().int().positive().optional(),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  // Resolver el número desde el mensaje (el payload real lleva metadata).
  // Como Meta, el mock todavía no sabe de qué organización es: sistema.
  const db = getSystemDb();
  const rows = await db
    .select({ organizationId: schema.message.organizationId })
    .from(schema.message)
    .where(eq(schema.message.waMessageId, body.data.waMessageId))
    .limit(1);
  if (!rows[0]) return apiError(404, "not_found", "Mensaje no encontrado");

  const orgId = rows[0].organizationId;
  const creds = await runWithOrganization(orgId, () => getCredentialsByOrg(orgId));
  if (!creds) return apiError(409, "not_connected", "Sin número conectado");

  const payload = buildStatusPayload({
    wabaId: creds.wabaId,
    phoneNumberId: creds.phoneNumberId,
    waMessageId: body.data.waMessageId,
    status: body.data.status,
    errorCode: body.data.errorCode,
    errorMessage: body.data.errorMessage,
    pricing: body.data.pricing,
    timestamp: body.data.timestamp,
  });
  const res = await deliverToWebhook(payload);
  return res.ok
    ? Response.json({ delivered: true })
    : apiError(502, "webhook_error", `El webhook respondió ${res.status}`);
}
