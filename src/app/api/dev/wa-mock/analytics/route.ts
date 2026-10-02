import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { parseBody } from "@/lib/api";
import { getWaMockState } from "@/server/dev/wa-mock-state";
import { runDailyAnalyticsSync } from "@/server/meta-sync/daily";

export const dynamic = "force-dynamic";

/**
 * Campañas v2 (PR 3) — Para el guion E2E: activa o desactiva las analíticas
 * de plantillas en la WABA simulada y, con `sync: true`, corre YA la
 * sincronización diaria de analíticas (sin esperar al día siguiente).
 */
const bodySchema = z.object({
  templateAnalyticsDisabled: z.boolean().optional(),
  sync: z.boolean().optional(),
});

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const state = getWaMockState();
  if (body.data.templateAnalyticsDisabled !== undefined) state.templateAnalyticsDisabled = body.data.templateAnalyticsDisabled;
  const result = body.data.sync ? await runDailyAnalyticsSync(new Date(), { force: true }) : null;
  return Response.json({ templateAnalyticsDisabled: !!state.templateAnalyticsDisabled, result });
}
