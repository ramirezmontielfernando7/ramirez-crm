import { eq, notExists, sql } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { Db } from "@/lib/db";
import type { Channel } from "@/lib/channels";
import { logger } from "@/lib/log";
import { MODULE_PROFILES, type ModuleProfile } from "@/lib/modules/registry";
import {
  envModuleDefaults,
  optionalChannelsOf,
  parseSendRate,
  type OptionalChannel,
  type OrgModules,
} from "./defaults";

const log = logger("modules");

/**
 * Fase 3, PR 3 — Lectura y escritura de `organization_module`.
 *
 * Se lee con el pool de sistema, siempre con la organización explícita: lo
 * consultan caminos que todavía no tienen contexto de organización (el
 * arranque, un webhook recién enrutado, el layout antes de abrir el
 * contexto). Igual que el estado de la organización, se recuerda unos segundos
 * por proceso; quien lo cambia en este proceso lo olvida al instante.
 *
 * Sin fila, valen las variables de entorno: es exactamente lo que pasaba
 * antes de este PR, así que entre migrar y rellenar nada cambia.
 */

const TTL_MS = 5_000;
const globalForModules = globalThis as unknown as {
  __voceroOrgModules?: Map<string, { modules: OrgModules; at: number }>;
};
function cache() {
  return (globalForModules.__voceroOrgModules ??= new Map());
}

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

type Row = typeof schema.organizationModule.$inferSelect;

function fromRow(row: Row, defaults: OrgModules): OrgModules {
  const channels = new Set<Channel>(["whatsapp"]);
  for (const c of row.channels) if (c === "instagram" || c === "messenger") channels.add(c);
  return {
    campaigns: row.campaigns,
    agenda: row.agenda,
    atribucion: row.atribucion,
    channels,
    campaignSendRate: parseSendRate(row.campaignSendRate) ?? defaults.campaignSendRate,
    knowledge: row.knowledge,
    agent: row.agent,
    // El CHECK de la 0034 ya lo impide; se repite por si alguien escribe a mano.
    lab: row.lab && row.agent,
    teamChat: row.teamChat,
    results: row.results,
    customNav: row.customNav,
    trabajo: row.trabajo,
  };
}

/** Los módulos de una organización (sin fila: los del entorno). */
export async function getOrgModules(organizationId: string): Promise<OrgModules> {
  const hit = cache().get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.modules;
  const defaults = envModuleDefaults();
  const [row] = await sys()
    .select()
    .from(schema.organizationModule)
    .where(scoped(schema.organizationModule.organizationId, organizationId))
    .limit(1);
  const modules = row ? fromRow(row, defaults) : defaults;
  cache().set(organizationId, { modules, at: Date.now() });
  return modules;
}

export function forgetOrgModules(organizationId?: string): void {
  if (organizationId) cache().delete(organizationId);
  else cache().clear();
  anyCache().clear();
}

const globalForAny = globalThis as unknown as {
  __voceroAnyChannel?: Map<OptionalChannel, { yes: boolean; at: number }>;
};
function anyCache() {
  return (globalForAny.__voceroAnyChannel ??= new Map());
}

/**
 * ¿Alguna organización tiene este canal? Con fila: su `channels`. Sin fila:
 * la variable `CHANNELS`. WhatsApp, siempre.
 */
export async function anyOrgHasChannel(channel: Channel): Promise<boolean> {
  if (channel === "whatsapp") return true;
  const hit = anyCache().get(channel);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.yes;
  const byDefault = envModuleDefaults().channels.has(channel);
  const [row] = (await sys().execute(sql`
    select (
      exists (select 1 from organization_module where ${channel} = any(channels))
      or (${byDefault}::boolean and exists (
        select 1 from organization o
        where not exists (select 1 from organization_module m where m.organization_id = o.id)
      ))
    ) as yes`)) as unknown as { yes: boolean }[];
  const yes = Boolean(row?.yes);
  anyCache().set(channel, { yes, at: Date.now() });
  return yes;
}

/** La fila que representa los valores del entorno. */
function defaultsRow(organizationId: string) {
  const d = envModuleDefaults();
  return {
    organizationId,
    campaigns: d.campaigns,
    agenda: d.agenda,
    atribucion: d.atribucion,
    channels: optionalChannelsOf(d.channels),
    // Nulo: sigue a CAMPAIGN_SEND_RATE mientras nadie lo fije a mano.
    campaignSendRate: null,
    knowledge: d.knowledge,
    lab: d.lab,
    agent: d.agent,
    teamChat: d.teamChat,
    results: d.results,
    customNav: d.customNav,
    trabajo: d.trabajo,
    updatedBy: "entorno",
  };
}

/**
 * Lo que toda organización nueva trae: los módulos que dicen las variables
 * de entorno. Dentro de la transacción del alta (`seedOrganization`).
 */
export async function seedOrgModules(
  tx: Db,
  organizationId: string,
  profile?: ModuleProfile
): Promise<void> {
  await tx
    .insert(schema.organizationModule)
    .values({ ...defaultsRow(organizationId), ...(profile ? profileRow(profile) : {}) })
    .onConflictDoNothing();
}

/**
 * 030 (PR 4) — Perfil de alta (Básico o Completo): SOLO una plantilla para
 * los interruptores al crear la organización; no se guarda cuál fue.
 */
function profileRow(profile: ModuleProfile) {
  const p = MODULE_PROFILES[profile].modules;
  return {
    campaigns: p.campaigns,
    agenda: p.agenda,
    atribucion: p.atribucion,
    knowledge: p.knowledge,
    agent: p.agent,
    lab: p.lab && p.agent,
    teamChat: p.team_chat,
    results: p.results,
    customNav: p.customNav,
    trabajo: p.trabajo,
    updatedBy: `perfil:${profile}`,
  };
}

/**
 * Relleno al arrancar: a cada organización SIN fila le pone lo que el entorno
 * tiene encendido hoy. Idempotente (`on conflict do nothing`) y nunca pisa
 * una fila que ya existe: lo que el administrador cambió se queda. Nunca
 * tumba el arranque.
 */
export async function backfillOrgModules(): Promise<number> {
  try {
    const d = defaultsRow("");
    const inserted = await sys()
      .insert(schema.organizationModule)
      .select(
        sys()
          .select({
            organizationId: schema.organization.id,
            campaigns: sql<boolean>`${d.campaigns}::boolean`.as("campaigns"),
            agenda: sql<boolean>`${d.agenda}::boolean`.as("agenda"),
            atribucion: sql<boolean>`${d.atribucion}::boolean`.as("atribucion"),
            channels: sql<string[]>`${`{${d.channels.join(",")}}`}::text[]`.as("channels"),
            campaignSendRate: sql<number | null>`null::integer`.as("campaign_send_rate"),
            knowledge: sql<boolean>`${d.knowledge}::boolean`.as("knowledge"),
            lab: sql<boolean>`${d.lab}::boolean`.as("lab"),
            agent: sql<boolean>`${d.agent}::boolean`.as("agent"),
            teamChat: sql<boolean>`${d.teamChat}::boolean`.as("team_chat"),
            results: sql<boolean>`${d.results}::boolean`.as("results"),
            customNav: sql<boolean>`${d.customNav}::boolean`.as("custom_nav"),
            trabajo: sql<boolean>`${d.trabajo}::boolean`.as("trabajo"),
            updatedAt: sql<Date>`now()`.as("updated_at"),
            updatedBy: sql<string>`${d.updatedBy}`.as("updated_by"),
          })
          .from(schema.organization)
          .where(
            notExists(
              sys()
                .select({ one: sql`1` })
                .from(schema.organizationModule)
                .where(eq(schema.organizationModule.organizationId, schema.organization.id))
            )
          )
      )
      .onConflictDoNothing()
      .returning({ id: schema.organizationModule.organizationId });
    if (inserted.length > 0) {
      log.info(`módulos por organización: ${inserted.length} organización(es) con los valores del entorno`);
    }
    forgetOrgModules();
    return inserted.length;
  } catch (err) {
    log.error("no se pudieron rellenar los módulos por organización (se usan las variables de entorno)", {
      err,
    });
    return 0;
  }
}

export type ModulesPatch = {
  campaigns?: boolean;
  agenda?: boolean;
  atribucion?: boolean;
  channels?: OptionalChannel[];
  campaignSendRate?: number | null;
  knowledge?: boolean;
  lab?: boolean;
  agent?: boolean;
  teamChat?: boolean;
  results?: boolean;
  customNav?: boolean;
  trabajo?: boolean;
};

/**
 * 030 (PR 4) — El Laboratorio requiere al Agente. Apagar el Agente apaga
 * también el Laboratorio; encender el Laboratorio sin Agente es un error de
 * quien lo pide (lo decide `resolveModulesPatch` antes de escribir).
 */
export class ModuleDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleDependencyError";
  }
}

export function resolveLabAgent(before: { lab: boolean; agent: boolean }, patch: { lab?: boolean; agent?: boolean }): { lab: boolean; agent: boolean } {
  const agent = patch.agent ?? before.agent;
  if (patch.lab === true && !agent) {
    throw new ModuleDependencyError("El Laboratorio requiere el Agente: enciende primero el Agente");
  }
  const lab = agent ? (patch.lab ?? before.lab) : false;
  return { lab, agent };
}

/**
 * Lo cambia SOLO el administrador de plataforma (`/platform`). Devuelve el
 * antes y el después para la bitácora.
 */
export async function updateOrgModules(
  organizationId: string,
  patch: ModulesPatch,
  actor: string
): Promise<{ before: OrgModules; after: OrgModules }> {
  forgetOrgModules(organizationId);
  const before = await getOrgModules(organizationId);
  const base = defaultsRow(organizationId);
  const values = {
    ...base,
    campaigns: patch.campaigns ?? before.campaigns,
    agenda: patch.agenda ?? before.agenda,
    atribucion: patch.atribucion ?? before.atribucion,
    channels: patch.channels ?? optionalChannelsOf(before.channels),
    knowledge: patch.knowledge ?? before.knowledge,
    teamChat: patch.teamChat ?? before.teamChat,
    results: patch.results ?? before.results,
    customNav: patch.customNav ?? before.customNav,
    trabajo: patch.trabajo ?? before.trabajo,
    ...resolveLabAgent(before, patch),
    updatedBy: actor,
    updatedAt: new Date(),
  };
  const [current] = await sys()
    .select({ rate: schema.organizationModule.campaignSendRate })
    .from(schema.organizationModule)
    .where(scoped(schema.organizationModule.organizationId, organizationId))
    .limit(1);
  const campaignSendRate =
    patch.campaignSendRate === undefined ? (current?.rate ?? null) : patch.campaignSendRate;
  await sys()
    .insert(schema.organizationModule)
    .values({ ...values, campaignSendRate })
    .onConflictDoUpdate({
      target: schema.organizationModule.organizationId,
      set: {
        campaigns: values.campaigns,
        agenda: values.agenda,
        atribucion: values.atribucion,
        channels: values.channels,
        campaignSendRate,
        knowledge: values.knowledge,
        lab: values.lab,
        agent: values.agent,
        teamChat: values.teamChat,
        results: values.results,
        customNav: values.customNav,
        trabajo: values.trabajo,
        updatedBy: actor,
        updatedAt: values.updatedAt,
      },
    });
  forgetOrgModules(organizationId);
  const after = await getOrgModules(organizationId);
  return { before, after };
}
