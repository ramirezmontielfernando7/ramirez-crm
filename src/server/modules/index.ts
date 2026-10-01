import type { Channel } from "@/lib/channels";
import { getOrgModules } from "./store";

/**
 * Fase 3, PR 3 — Preguntas de una línea sobre los módulos de una
 * organización. Todo camino que antes leía una bandera de despliegue
 * pregunta ahora por la organización a nombre de la cual actúa.
 */
export { anyOrgHasChannel, getOrgModules, forgetOrgModules } from "./store";
export type { OrgModules, OptionalChannel } from "./defaults";
export { OPTIONAL_CHANNELS } from "./defaults";

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
