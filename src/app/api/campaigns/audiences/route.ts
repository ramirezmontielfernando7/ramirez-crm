import { forbidden, withAuth } from "@/lib/api";
import { can } from "@/lib/auth/permissions";
import { campaignsDisabledResponse, campaignsEnabled } from "@/server/campaigns/flag";
import { campaignErrorResponse, formFile, formMapping } from "@/server/campaigns/http";
import { importAudienceFile, listAudiences } from "@/server/campaigns/audiences";
import { IMPORT_MAX_BYTES } from "@/server/contacts-io/validate";

export const dynamic = "force-dynamic";

/** Campañas v2 — Las bases guardadas (Audiencias), la más reciente primero. */
export const GET = withAuth(
  async (session) => {
    if (!(await campaignsEnabled(session.organizationId))) return campaignsDisabledResponse();
    return Response.json({ audiences: await listAudiences(session.organizationId) });
  },
  { permission: "campaigns.manage" }
);

/**
 * Campañas v2 — Sube e importa una base .xlsx/.csv (multipart: `file`,
 * `mapping?` JSON, `name?`, `consentDeclaration`). Usa el mismo núcleo que la
 * importación de Contactos, así que además pide `contacts.import`.
 */
export const POST = withAuth(
  async (session, req: Request) => {
    if (!(await campaignsEnabled(session.organizationId))) return campaignsDisabledResponse();
    if (!can(session, "contacts.import")) return forbidden();
    const f = await formFile(req, IMPORT_MAX_BYTES);
    if (!f.ok) return f.response;
    try {
      const result = await importAudienceFile({
        organizationId: session.organizationId,
        userId: session.userId,
        fileName: (f.file.name || "base.csv").slice(0, 120),
        bytes: f.bytes,
        mapping: formMapping(f.form),
        name: String(f.form.get("name") ?? "").trim() || null,
        consentDeclaration: String(f.form.get("consentDeclaration") ?? ""),
      });
      return Response.json(result, { status: 201 });
    } catch (err) {
      return campaignErrorResponse(err);
    }
  },
  { permission: "campaigns.manage" }
);
