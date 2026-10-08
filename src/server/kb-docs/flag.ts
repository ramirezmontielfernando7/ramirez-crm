import { getEnv } from "@/lib/env";
import { orgHasModule } from "@/server/modules";

/**
 * 035 — ¿Existen los Documentos del agente?
 *
 * Dos llaves: `KB_DOCS` (interruptor de la INSTANCIA, apagado por defecto; se
 * lee SOLO aquí) y, por organización, el módulo Laboratorio (que a su vez
 * requiere Agente). Sin cualquiera de las dos, la pestaña y sus rutas no
 * existen (404) y el agente no consulta documentos: responde como siempre.
 */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function kbDocsEnabled(): boolean {
  return ON_VALUES.has(getEnv().KB_DOCS?.trim().toLowerCase() ?? "");
}

/** ¿Esta organización usa documentos? (instancia + módulo Laboratorio). */
export async function orgHasKbDocs(organizationId: string): Promise<boolean> {
  return kbDocsEnabled() && (await orgHasModule(organizationId, "lab"));
}

/** Para las rutas: el 404 si la instancia no tiene documentos (el módulo lo mira `moduleOff`). */
export function kbDocsOff(): Response | null {
  return kbDocsEnabled() ? null : new Response(null, { status: 404 });
}
