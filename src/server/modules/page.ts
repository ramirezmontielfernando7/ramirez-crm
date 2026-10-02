import { notFound, redirect } from "next/navigation";
import { getSessionOrNull, type SessionContext } from "@/lib/auth/session";
import type { ModuleKey } from "@/lib/modules/registry";
import { orgHasModule } from "./index";

/**
 * 030 (PR 4) — Guardia de PÁGINA por módulo: apagado para esta organización,
 * la pantalla no existe (404), igual que sus rutas de la API. Ocultar una
 * entrada del menú (Ajustes → Navegación) NO pasa por aquí: es solo estético.
 */
export async function requireModulePage(key: ModuleKey): Promise<SessionContext> {
  const session = await getSessionOrNull();
  if (!session) redirect("/login");
  if (!(await orgHasModule(session.organizationId, key))) notFound();
  return session;
}
