import { isChannel, type Channel } from "@/lib/channels";

/**
 * Fase 3, PR 3 — Los módulos opcionales de UNA organización.
 *
 * Antes eran banderas de despliegue para toda la instancia. Ahora cada
 * organización tiene su fila en `organization_module` (la edita el
 * administrador de plataforma) y las variables de entorno quedan solo como
 * VALOR POR DEFECTO: para las organizaciones nuevas, para el relleno al
 * arrancar y para una organización que (todavía) no tenga fila.
 *
 * Este es el ÚNICO archivo que lee `CAMPAIGNS`, `AGENDA`, `ATRIBUCION`,
 * `CHANNELS` y `CAMPAIGN_SEND_RATE` del entorno (test de vigilancia en
 * tests/unit/modules-guard.test.ts). Se leen de `process.env` directo, no por
 * `getEnv()`: preguntar si un módulo existe no puede depender de que TODO el
 * entorno valide (un turno del agente reventaba solo por consultar la agenda).
 */

/** Valores que cuentan como "encendida". Cualquier otra cosa, apagada. */
const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

function parseOnOff(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

export const parseCampaignsFlag = parseOnOff;
export const parseAgendaFlag = parseOnOff;
export const parseAtribucionFlag = parseOnOff;

/** WhatsApp no se puede apagar: es el canal por el que existe el producto. */
export function parseChannels(raw: string | undefined): Set<Channel> {
  const enabled = new Set<Channel>(["whatsapp"]);
  for (const part of (raw ?? "").split(",")) {
    const name = part.trim().toLowerCase();
    // Cualquier canal del catálogo, no una lista escrita a mano aquí: el
    // canal siguiente solo tiene que existir en lib/channels.ts.
    if (isChannel(name)) enabled.add(name);
  }
  return enabled;
}

/** Canales que se pueden encender o apagar. WhatsApp no: siempre está. */
export const OPTIONAL_CHANNELS = ["instagram", "messenger"] as const;
export type OptionalChannel = (typeof OPTIONAL_CHANNELS)[number];

export type OrgModules = {
  campaigns: boolean;
  agenda: boolean;
  atribucion: boolean;
  /** Canales encendidos, WhatsApp siempre incluido. */
  channels: ReadonlySet<Channel>;
  /** Mensajes por segundo de las campañas (1–80). */
  campaignSendRate: number;
};

export const DEFAULT_SEND_RATE = 10;
export const MAX_SEND_RATE = 80;

/**
 * Meta admite ~80/s por número, pero un número nuevo tiene límites diarios de
 * destinatarios y la calidad cae si se dispara todo junto: 10/s es
 * conservador y se puede subir.
 */
export function parseSendRate(raw: string | number | null | undefined): number | null {
  const n = Number(raw ?? "");
  if (raw === null || raw === undefined || raw === "" || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), MAX_SEND_RATE) || 1;
}

/** Lo que dicen las variables de entorno: el valor por defecto. */
export function envModuleDefaults(): OrgModules {
  return {
    campaigns: parseCampaignsFlag(process.env.CAMPAIGNS),
    agenda: parseAgendaFlag(process.env.AGENDA),
    atribucion: parseAtribucionFlag(process.env.ATRIBUCION),
    channels: parseChannels(process.env.CHANNELS),
    campaignSendRate: parseSendRate(process.env.CAMPAIGN_SEND_RATE) ?? DEFAULT_SEND_RATE,
  };
}

/** Los canales opcionales de un conjunto, en el orden del catálogo. */
export function optionalChannelsOf(channels: ReadonlySet<Channel>): OptionalChannel[] {
  return OPTIONAL_CHANNELS.filter((c) => channels.has(c));
}
