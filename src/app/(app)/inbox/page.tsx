import { InboxClient, type InboxInitial } from "@/components/inbox/inbox-client";
import { CHANNEL_ORDER } from "@/lib/channels";
import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { logger } from "@/lib/log";
import { runWithOrganization } from "@/lib/request-context";
import { DEFAULT_FILTERS, PAGE_SIZE, type ListQuery } from "@/lib/inbox-list";
import { enabledChannels } from "@/server/channels/enabled";
import { countConversations, listConversationsPage } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

const log = logger("inbox");

/**
 * Fluidez PR 4 — Lo que la Bandeja muestra al abrir: la principal, sin
 * filtros. Debe ser la MISMA consulta con que arranca `ConversationList`;
 * si no coincide, el navegador simplemente la pide como antes.
 */
const FIRST_QUERY: ListQuery = { ...DEFAULT_FILTERS, view: "main", status: "all" };

export default async function InboxPage() {
  /**
   * 014 — Qué bandejas existen se decide en el servidor, no mirando los datos.
   * Si se dedujera de las conversaciones cargadas, la marca de canal aparecería
   * y desaparecería sola: una instancia con Instagram encendido pero sin DMs
   * todavía se vería como una instancia de un solo canal, y el primer mensaje
   * repintaría la lista entera.
   */
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  const enabled = await enabledChannels(session.organizationId);
  const channels = CHANNEL_ORDER.filter((c) => enabled.has(c));

  /**
   * Fluidez PR 4 — La primera página (50 chats) y sus contadores llegan YA
   * PINTADOS en el HTML: sin el instante de «Cargando…». Son las mismas
   * funciones, con el mismo `session.access` (organización y rol), que
   * `GET /api/conversations?limit=` y `/counts`: un asesor ve aquí solo lo
   * suyo, igual que en la API. Si algo falla, la Bandeja abre como antes y el
   * navegador la pide.
   */
  const initial = await runWithOrganization(session.organizationId, async (): Promise<InboxInitial | null> => {
    try {
      const [page, counts] = await Promise.all([
        listConversationsPage(session.access, FIRST_QUERY.view, FIRST_QUERY, { limit: PAGE_SIZE, cursor: null }),
        countConversations(session.access, FIRST_QUERY),
      ]);
      // Por JSON, como la API: el navegador recibe exactamente lo mismo.
      return JSON.parse(JSON.stringify({ query: FIRST_QUERY, ...page, counts })) as InboxInitial;
    } catch (err) {
      log.error("primera página de la Bandeja", { err });
      return null;
    }
  });

  return <InboxClient channels={channels} initial={initial} />;
}
