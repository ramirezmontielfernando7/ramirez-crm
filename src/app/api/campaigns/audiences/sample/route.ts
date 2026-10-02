import { withAuth } from "@/lib/api";
import { toCsv } from "@/lib/csv";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { buildXlsx, SAMPLE_AUDIENCE_ROWS } from "@/server/contacts-io/xlsx-write";

export const dynamic = "force-dynamic";

/** Campañas v2 — El archivo de ejemplo (`?format=xlsx` o `csv`). */
export const GET = withAuth(
  async (session, req: Request) => {
    if (!(await campaignsEnabled(session.organizationId))) return campaignsDisabledResponse();
    const xlsx = new URL(req.url).searchParams.get("format") !== "csv";
    if (xlsx) {
      return new Response(Buffer.from(buildXlsx("Contactos", SAMPLE_AUDIENCE_ROWS)), {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": 'attachment; filename="ejemplo-audiencia.xlsx"',
          "cache-control": "no-store",
        },
      });
    }
    const [header, ...rows] = SAMPLE_AUDIENCE_ROWS;
    return new Response(toCsv(header!, rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="ejemplo-audiencia.csv"',
        "cache-control": "no-store",
      },
    });
  },
  { permission: "campaigns.manage" }
);
