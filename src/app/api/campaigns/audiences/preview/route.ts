import { forbidden, withAuth } from "@/lib/api";
import { can } from "@/lib/auth/permissions";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { campaignErrorResponse, formFile, formMapping } from "@/server/campaigns/http";
import { previewAudienceFile } from "@/server/campaigns/audiences";
import { IMPORT_MAX_BYTES } from "@/server/contacts-io/validate";

export const dynamic = "force-dynamic";

/**
 * Campañas v2 — Vista previa de una base SIN escribir nada: columnas
 * reconocidas (o qué falta asignar), primeras filas con las inválidas
 * marcadas y el resumen.
 */
export const POST = withAuth(
  async (session, req: Request) => {
    if (!(await campaignsEnabled(session.organizationId))) return campaignsDisabledResponse();
    if (!can(session, "contacts.import")) return forbidden();
    const f = await formFile(req, IMPORT_MAX_BYTES);
    if (!f.ok) return f.response;
    try {
      const preview = await previewAudienceFile({
        fileName: (f.file.name || "base.csv").slice(0, 120),
        bytes: f.bytes,
        mapping: formMapping(f.form),
      });
      return Response.json({ preview });
    } catch (err) {
      return campaignErrorResponse(err);
    }
  },
  { permission: "campaigns.manage" }
);
