import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { requireModulePage } from "@/server/modules/page";
import { AssistantClient } from "@/components/assistant/assistant-client";

export const dynamic = "force-dynamic";

/**
 * 038 (PR 1) — Asistente interno. Sin el módulo (premium, lo enciende la
 * plataforma) la pantalla no existe (404); quien no es Propietario vuelve a la
 * Bandeja (la API ya responde 403). Las preguntas llegan con el motor (PR 2).
 */
export default async function AsistentePage() {
  const session = await requireModulePage("asistente");
  if (!can(session, "assistant.use")) redirect("/inbox");
  return <AssistantClient />;
}
