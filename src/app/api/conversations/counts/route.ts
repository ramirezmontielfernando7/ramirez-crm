import { withAuth } from "@/lib/api";
import { parseListFilters } from "@/lib/inbox-list";
import { countConversations } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

/**
 * Fluidez PR 3 — Los contadores de la Bandeja con los filtros de la pantalla
 * (`q`, `stage`, `tag`, `assigned`, `channel`), sin bajar la lista: «Todas»,
 * «No leídas», «Archivados», «Atención humana», «Anuncios», «Campañas», cada
 * bandeja, y lo que ofrecen los selectores (etapas, etiquetas, personas).
 * Mismo filtro de organización y de asesor que la lista.
 */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  return Response.json(await countConversations(session.access, parseListFilters(url.searchParams)));
});
