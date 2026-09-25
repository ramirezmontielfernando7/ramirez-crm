import { apiError, withAuth } from "@/lib/api";
import { toCsv } from "@/lib/csv";
import { RECIPIENT_STATUS_LABEL, type RecipientStatus } from "@/lib/campaigns";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { campaignErrorResponse } from "@/server/campaigns/http";
import { listRecipients } from "@/server/campaigns/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const STATUSES: RecipientStatus[] = ["pending", "sent", "failed"];

/**
 * 021 — El log de auditoría: a quién, cuándo y con qué resultado.
 * `?status=failed` filtra; `?format=csv` lo descarga completo.
 */
export const GET = withAuth(
  async (session, req: Request, ctx: Params) => {
    if (!campaignsEnabled()) return campaignsDisabledResponse();
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const rawStatus = url.searchParams.get("status");
    if (rawStatus && !STATUSES.includes(rawStatus as RecipientStatus)) {
      return apiError(422, "invalid_filter", `Estado no válido: ${rawStatus}`);
    }
    const status = (rawStatus as RecipientStatus | null) ?? undefined;
    const csv = url.searchParams.get("format") === "csv";
    try {
      const recipients = await listRecipients(session.organizationId, id, {
        status,
        limit: csv ? 20_000 : Math.min(Number(url.searchParams.get("limit") ?? 500) || 500, 2000),
        offset: csv ? 0 : Number(url.searchParams.get("offset") ?? 0) || 0,
      });
      if (!csv) return Response.json({ recipients });
      const body = toCsv(
        ["name", "phone", "status", "error", "sentAt"],
        recipients.map((r) => [r.contactName, r.phone, RECIPIENT_STATUS_LABEL[r.status], r.errorMessage, r.sentAt])
      );
      return new Response(body, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="campana-${id}${status ? `-${status}` : ""}.csv"`,
          "cache-control": "no-store",
        },
      });
    } catch (err) {
      return campaignErrorResponse(err);
    }
  },
  { permission: "campaigns.manage" }
);
