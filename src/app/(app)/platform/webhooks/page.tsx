import { notFound } from "next/navigation";
import { WebhooksClient } from "@/components/platform/webhooks-client";
import { currentPlatformAdmin } from "@/server/platform-admin/admins";

export const dynamic = "force-dynamic";

/** 040 — Plataforma → Webhooks sin ruta (solo metadatos de `webhook_unrouted`). */
export default async function PlatformWebhooksPage() {
  if (!(await currentPlatformAdmin())) notFound();
  return <WebhooksClient />;
}
