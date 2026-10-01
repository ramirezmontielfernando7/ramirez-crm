import { eq, notExists, sql } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { Db } from "@/lib/db";
import type { Channel } from "@/lib/channels";
import { logger } from "@/lib/log";
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
    updatedBy: "entorno",
  };
}

/**
 * Lo que toda organización nueva trae: los módulos que dicen las variables
 * de entorno. Dentro de la transacción del alta (`seedOrganization`).
 */
export async function seedOrgModules(tx: Db, organizationId: string): Promise<void> {
  await tx.insert(schema.organizationModule).values(defaultsRow(organizationId)).onConflictDoNothing();
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
};

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
        updatedBy: actor,
        updatedAt: values.updatedAt,
      },
    });
  forgetOrgModules(organizationId);
  const after = await getOrgModules(organizationId);
  return { before, after };
}
