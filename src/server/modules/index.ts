import type { Channel } from "@/lib/channels";
import type { ModuleKey } from "@/lib/modules/registry";
import { enabledModuleKeys } from "./defaults";
import { getOrgModules } from "./store";

/**
 * Fase 3, PR 3 — Preguntas de una línea sobre los módulos de una
 * organización. Todo camino que antes leía una bandera de despliegue
 * pregunta ahora por la organización a nombre de la cual actúa.
 */
export { anyOrgHasChannel, getOrgModules, forgetOrgModules } from "./store";
export type { OrgModules, OptionalChannel } from "./defaults";
export { OPTIONAL_CHANNELS, enabledModuleKeys } from "./defaults";

export async function orgHasCampaigns(organizationId: string): Promise<boolean> {
  return (await getOrgModules(organizationId)).campaigns;
}

export async function orgHasAgenda(organizationId: string): Promise<boolean> {
  return (await getOrgModules(organizationId)).agenda;
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
