import { apiError, withAuth } from "@/lib/api";
import { filterFromSearchParams } from "@/server/contact-filter";
import { exportContactsCsv } from "@/server/contacts-io/export";

export const dynamic = "force-dynamic";

/**
 * 021 — Exporta los contactos a CSV respetando los mismos filtros de la lista
 * (`q`, `stage`, `archived`, `tag`, `source`, `consent`). Sin tope de 200.
 */
export const GET = withAuth(
  async (session, req: Request) => {
    const url = new URL(req.url);
    const filter = filterFromSearchParams(url.searchParams);
    if ("error" in filter) return apiError(422, "invalid_filter", filter.error);
    const res = await exportContactsCsv(session, {
      q: url.searchParams.get("q") ?? undefined,
      stage: url.searchParams.get("stage") ?? undefined,
      includeArchived: url.searchParams.get("archived") === "true",
      filter,
    });
    if (!res.ok) {
      return apiError(
        413,
        "too_many",
        `Son más de ${res.max.toLocaleString("es-MX")} contactos: filtra por etiqueta o fuente y exporta por partes`
      );
    }
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(res.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="contactos-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  },
  { permission: "contacts.export" }
);
