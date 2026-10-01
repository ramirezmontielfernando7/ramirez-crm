import { InboxClient } from "@/components/inbox/inbox-client";
import { CHANNEL_ORDER } from "@/lib/channels";
import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { enabledChannels } from "@/server/channels/enabled";

export const dynamic = "force-dynamic";

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

  return <InboxClient channels={channels} />;
}
