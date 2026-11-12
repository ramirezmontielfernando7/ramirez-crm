import { redirect } from "next/navigation";
import { AgentClient } from "@/components/agent/agent-client";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { getSessionOrNull } from "@/lib/auth/session";
import { orgHasModule } from "@/server/modules";
import { requireModulePage } from "@/server/modules/page";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  // 020: sin permiso, de vuelta a la Bandeja (la API ya responde 403).
  await requirePagePermission("agent.manage");
  // 030 (PR 4): sin el módulo, la pantalla no existe para esta organización.
  await requireModulePage("agent");
  // Con Laboratorio, el agente general se edita en Agentes IA y el interruptor
  // general y el cerebro externo viven en Ajustes → Quién contesta: esta
  // pantalla vieja solo queda para el plan sin Laboratorio («Mi agente»).
  const session = await getSessionOrNull();
  if (session && (await orgHasModule(session.organizationId, "lab"))) redirect("/lab");
  return <AgentClient />;
}
