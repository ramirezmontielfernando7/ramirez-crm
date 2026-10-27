import type { Channel } from "@/lib/channels";
import type { ModuleKey } from "@/lib/modules/registry";
import { enabledModuleKeys } from "./defaults";
import { getOrgModules } from "./store";

/**
 * Fase 3, PR 3 — Preguntas de una línea sobre los módulos de una
 * organización. Todo camino que antes leía una bandera de despliegue
 * pregunta ahora por la organización a nombre de la cual actúa.
 */
export { anyOrgHasChannel, getOrgModules, getManyOrgModules, forgetOrgModules } from "./store";
export type { OrgModules, OptionalChannel } from "./defaults";
export { OPTIONAL_CHANNELS, enabledModuleKeys } from "./defaults";

export async function orgHasCampaigns(organizationId: string): Promise<boolean> {
  return (await getOrgModules(organizationId)).campaigns;
}

export async function orgHasAgenda(organizationId: string): Promise<boolean> {
  return (await getOrgModules(organizationId)).agenda;
}

/** 033 — Tareas y Notas (Citas es `agenda`). */
export async function orgHasTrabajo(organizationId: string): Promise<boolean> {
  return (await getOrgModules(organizationId)).trabajo;
}

export async function orgHasAtribucion(organizationId: string): Promise<boolean> {
  return (await getOrgModules(organizationId)).atribucion;
}

export async function orgChannels(organizationId: string): Promise<ReadonlySet<Channel>> {
  return (await getOrgModules(organizationId)).channels;
}

export async function orgHasChannel(organizationId: string, channel: Channel): Promise<boolean> {
  return (await getOrgModules(organizationId)).channels.has(channel);
}

export async function orgCampaignSendRate(organizationId: string): Promise<number> {
  return (await getOrgModules(organizationId)).campaignSendRate;
}

/** 030 (PR 4) — Los módulos encendidos (claves del registro, con dependencias). */
export async function orgModuleKeys(organizationId: string): Promise<Set<ModuleKey>> {
  return enabledModuleKeys(await getOrgModules(organizationId));
}

/** 030 (PR 4) — ¿Existe este módulo para esta organización? (núcleo: siempre). */
export async function orgHasModule(organizationId: string, key: ModuleKey): Promise<boolean> {
  return (await orgModuleKeys(organizationId)).has(key);
}

/** Conexión directa (PR 1) — el complemento oculto. */
export async function orgHasConexionDirecta(organizationId: string): Promise<boolean> {
  return (await getOrgModules(organizationId)).conexionDirecta;
}

/**
 * Conexión directa (PR 1) — como `moduleOff`, para sus rutas: `null` si la
 * organización tiene el complemento; si no, el 404 listo (cero rastro).
 */
export async function conexionDirectaOff(organizationId: string): Promise<Response | null> {
  return (await orgHasConexionDirecta(organizationId)) ? null : new Response(null, { status: 404 });
}

/** Mi número (046) — el complemento sobre la conexión directa. */
export async function orgHasMiNumero(organizationId: string): Promise<boolean> {
  return (await getOrgModules(organizationId)).miNumero;
}

/** Conector de IA (047) — el complemento oculto. */
export async function orgHasConectorIa(organizationId: string): Promise<boolean> {
  return (await getOrgModules(organizationId)).conectorIa;
}

/** 030 (PR 4) — ¿Puede el Propietario personalizar el menú? */
export async function orgHasCustomNav(organizationId: string): Promise<boolean> {
  return (await getOrgModules(organizationId)).customNav;
}

/**
 * 030 (PR 4) — Para las rutas: `null` si el módulo existe; si no, el 404 listo
 * (apagado, la superficie no existe para esta organización). Va DESPUÉS del
 * permiso: `withAuth(..., { permission })` ya respondió 403 si faltaba.
 */
export async function moduleOff(organizationId: string, key: ModuleKey): Promise<Response | null> {
  return (await orgHasModule(organizationId, key)) ? null : new Response(null, { status: 404 });
}
